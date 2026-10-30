// Testes unitários de POST /api/integracao/clientes (nexaigen-educa →
// Financeiro). Mocka @/lib/db, @/lib/versionamentoPdf (o contrato vira VERSÃO
// desde a rodada 08 — testado em lib/versionamentoPdf.test.ts) e
// @/lib/alertaErroSistema — nunca Postgres, bucket ou Resend reais. O
// upsert de verdade (índice único parcial + ON CONFLICT) é exercitado
// contra Postgres real em route.integration.test.ts.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, registrarVersaoMock, alertarErroSistemaMock, registrarTentativaMock, desfazerTentativaMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  registrarVersaoMock: vi.fn(),
  alertarErroSistemaMock: vi.fn(),
  registrarTentativaMock: vi.fn(),
  desfazerTentativaMock: vi.fn()
}));
vi.mock("@/lib/db", () => ({ query: queryMock }));
vi.mock("@/lib/versionamentoPdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/versionamentoPdf")>()),
  registrarVersaoPdf: registrarVersaoMock
}));
vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: alertarErroSistemaMock }));
// Rate limit (rodada 07): só o contador é mockado — as regras e funções
// puras de lib/rateLimit.ts continuam reais. O contador em Postgres de
// verdade é testado em lib/rateLimit.integration.test.ts e em
// route.integration.test.ts.
vi.mock("@/lib/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rateLimit")>()),
  registrarTentativa: registrarTentativaMock,
  desfazerTentativa: desfazerTentativaMock
}));

import { NextRequest } from "next/server";
import { POST } from "./route";
import { LIMITE_INTEGRACAO_FALHA_AUTH, LIMITE_INTEGRACAO_POR_IP } from "@/lib/rateLimit";
import { ALVO_CONTRATO } from "@/lib/versionamentoPdf";

const SEGREDO = "segredo-de-teste-da-integracao";
const ENV_ORIGINAL = process.env.INTEGRACAO_SECRET;
const MUNICIPIO_ID = "6f1c2b0e-5a4d-4c3b-9e8f-1a2b3c4d5e6f";
const PDF_BASE64 = Buffer.from("%PDF-1.4\n%fake\n").toString("base64");

function corpoValido(extra: Record<string, unknown> = {}) {
  return {
    municipioIdExterno: MUNICIPIO_ID,
    nome: "Prefeitura Municipal de Teste",
    uf: "PR",
    valorMensal: 4500,
    dataInicioContrato: "2026-10-01",
    ...extra
  };
}

function requisicao(corpo: unknown, auth: string | null = `Bearer ${SEGREDO}`, extras: Record<string, string> = {}): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json", ...extras };
  if (auth) headers.authorization = auth;
  return new NextRequest("http://localhost:3001/api/integracao/clientes", {
    method: "POST",
    headers,
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo)
  });
}

function chamadaUpsert() {
  return queryMock.mock.calls.find((c: unknown[]) => (c[0] as string).includes("insert into cliente_prefeitura"));
}

beforeEach(() => {
  process.env.INTEGRACAO_SECRET = SEGREDO;
  queryMock.mockReset();
  registrarVersaoMock.mockReset();
  alertarErroSistemaMock.mockReset();
  registrarTentativaMock.mockReset();
  registrarTentativaMock.mockResolvedValue({ permitido: true, contagem: 1, retryAfterSegundos: 60 });
  desfazerTentativaMock.mockReset();
});

afterAll(() => {
  if (ENV_ORIGINAL === undefined) delete process.env.INTEGRACAO_SECRET;
  else process.env.INTEGRACAO_SECRET = ENV_ORIGINAL;
});

describe("POST /api/integracao/clientes — autenticação por INTEGRACAO_SECRET", () => {
  it("sem header Authorization — 401, sem tocar banco, sem alerta", async () => {
    const res = await POST(requisicao(corpoValido(), null));
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
    expect(alertarErroSistemaMock).not.toHaveBeenCalled();
  });

  it("segredo errado — 401, sem tocar banco, e NÃO dispara alerta de sistema", async () => {
    const res = await POST(requisicao(corpoValido(), "Bearer segredo-errado"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ erro: "Não autorizado." });
    expect(queryMock).not.toHaveBeenCalled();
    expect(alertarErroSistemaMock).not.toHaveBeenCalled();
  });

  it("INTEGRACAO_SECRET não configurado no servidor — 401 E alerta de sistema (categoria integracao_educa)", async () => {
    delete process.env.INTEGRACAO_SECRET;
    const res = await POST(requisicao(corpoValido(), "Bearer qualquer-coisa"));
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
    expect(alertarErroSistemaMock).toHaveBeenCalledWith("integracao_educa", expect.stringContaining("INTEGRACAO_SECRET"));
  });
});

describe("POST /api/integracao/clientes — validação do corpo", () => {
  it.each([
    ["JSON malformado", "{nao-json"],
    ["sem nome", corpoValido({ nome: undefined })],
    ["valorMensal negativo", corpoValido({ valorMensal: -1 })],
    ["uf com 3 letras", corpoValido({ uf: "PRR" })],
    ["municipioIdExterno não-uuid", corpoValido({ municipioIdExterno: "abc" })],
    ["dataInicioContrato fora de YYYY-MM-DD", corpoValido({ dataInicioContrato: "01/10/2026" })],
    ["diaVencimentoContrato 29", corpoValido({ diaVencimentoContrato: 29 })],
    ["contatoEmail inválido", corpoValido({ contatoEmail: "nao-e-email" })],
    ["base64 sem nome do arquivo", corpoValido({ contratoArquivoBase64: PDF_BASE64 })],
    ["nome do arquivo sem base64", corpoValido({ contratoArquivoNome: "contrato.pdf" })]
  ])("%s — 400, nunca grava", async (_desc, corpo) => {
    const res = await POST(requisicao(corpo));
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
    expect(registrarVersaoMock).not.toHaveBeenCalled();
  });

  it("devolve zod.flatten() em detalhes", async () => {
    const res = await POST(requisicao(corpoValido({ valorMensal: 0 })));
    const corpo = await res.json();
    expect(corpo.erro).toBe("Dados inválidos");
    expect(corpo.detalhes.fieldErrors.valorMensal).toBeDefined();
  });
});

describe("POST /api/integracao/clientes — upsert por municipio_id_externo", () => {
  it("municipio_id_externo novo — INSERT, devolve { id, criado: true }, aplica defaults no insert", async () => {
    queryMock.mockResolvedValue([{ id: "cliente-novo", criado: true }]);
    const res = await POST(requisicao(corpoValido()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "cliente-novo", criado: true });

    const [sql, params] = chamadaUpsert()!;
    expect(sql).toMatch(/on conflict \(municipio_id_externo\) where municipio_id_externo is not null do update/);
    expect(sql).toMatch(/coalesce\(\$6::text, 'essencial'\)/);
    expect(params[0]).toBe(MUNICIPIO_ID);
    // plano/dia ausentes chegam como null — default só no INSERT, coalesce mantém o salvo no UPDATE.
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
    // Contrato não entra mais no upsert (vira versão depois, em cliente_contrato_versao).
    expect(params).toHaveLength(15);
    expect(sql).not.toContain("contrato_arquivo");
    expect(registrarVersaoMock).not.toHaveBeenCalled();
  });

  it("municipio_id_externo já existente — UPDATE, devolve { id, criado: false }", async () => {
    queryMock.mockResolvedValue([{ id: "cliente-existente", criado: false }]);
    const res = await POST(requisicao(corpoValido({ plano: "completo", observacao: "retry do Educa" })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "cliente-existente", criado: false });
    const [, params] = chamadaUpsert()!;
    expect(params[5]).toBe("completo");
    expect(params[14]).toBe("retry do Educa");
  });

  it("falha do banco — 500 e alerta de sistema SEM dado do cliente na mensagem", async () => {
    queryMock.mockRejectedValue(Object.assign(new Error("conexão recusada"), { code: "ECONNREFUSED" }));
    const res = await POST(requisicao(corpoValido({ cnpj: "12.345.678/0001-90" })));

    expect(res.status).toBe(500);
    expect(alertarErroSistemaMock).toHaveBeenCalledTimes(1);
    const [categoria, mensagem] = alertarErroSistemaMock.mock.calls[0];
    expect(categoria).toBe("integracao_educa");
    expect(mensagem).not.toContain("Prefeitura Municipal de Teste");
    expect(mensagem).not.toContain("12.345.678/0001-90");
  });
});

describe("POST /api/integracao/clientes — contrato em base64", () => {
  it.each([
    ["base64 com caractere inválido", "%%%não-base64%%%"],
    ["base64 válido mas não é PDF", Buffer.from("isto não é um pdf").toString("base64")]
  ])("%s — 400, nunca faz upload nem grava cliente", async (_desc, base64) => {
    const res = await POST(requisicao(corpoValido({ contratoArquivoBase64: base64, contratoArquivoNome: "contrato.pdf" })));
    expect(res.status).toBe(400);
    expect(registrarVersaoMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("PDF maior que 10MB depois de decodificado — 400", async () => {
    const grande = Buffer.alloc(10 * 1024 * 1024 + 1);
    grande.write("%PDF-");
    const res = await POST(
      requisicao(corpoValido({ contratoArquivoBase64: grande.toString("base64"), contratoArquivoNome: "grande.pdf" }))
    );
    expect(res.status).toBe(400);
    expect(registrarVersaoMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("contrato válido — cliente gravado primeiro, depois o contrato vira uma VERSÃO nova (nunca sobrescreve), autor nulo e motivo com a origem", async () => {
    registrarVersaoMock.mockResolvedValue({ ok: true, versao: 2, tamanhoBytes: 10, sha256: "a".repeat(64) });
    queryMock.mockResolvedValue([{ id: "cliente-novo", criado: false }]);

    const res = await POST(requisicao(corpoValido({ contratoArquivoBase64: PDF_BASE64, contratoArquivoNome: "Contrato Jaguapitã 2026.pdf" })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "cliente-novo", criado: false, versaoContrato: 2 });
    const [alvo, clienteId, arquivo] = registrarVersaoMock.mock.calls[0];
    expect(alvo).toBe(ALVO_CONTRATO);
    expect(clienteId).toBe("cliente-novo");
    expect(arquivo).toMatchObject({ nome: "Contrato Jaguapitã 2026.pdf", enviadoPor: null, motivo: expect.stringMatching(/integração com o nexaigen-educa/) });
    expect((arquivo.buffer as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    // Ordem: upsert do cliente antes do registro da versão.
    expect(queryMock.mock.invocationCallOrder[queryMock.mock.calls.findIndex((c: unknown[]) => (c[0] as string).includes("insert into cliente_prefeitura"))]).toBeLessThan(
      registrarVersaoMock.mock.invocationCallOrder[0]
    );
  });

  it.each(["bucket", "banco"])("falha ao registrar a versão do contrato (%s) NÃO derruba o cadastro — cliente salvo + avisoContrato", async (motivo) => {
    registrarVersaoMock.mockResolvedValue({ ok: false, motivo });
    queryMock.mockResolvedValue([{ id: "cliente-novo", criado: true }]);

    const res = await POST(requisicao(corpoValido({ contratoArquivoBase64: PDF_BASE64, contratoArquivoNome: "contrato.pdf" })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "cliente-novo", criado: true, avisoContrato: "não foi possível salvar o contrato anexado" });
    expect(chamadaUpsert()).toBeDefined();
  });
});

describe("POST /api/integracao/clientes — limite de tentativas por IP", () => {
  const bloqueado = { permitido: false, contagem: 61, retryAfterSegundos: 42 };

  it("acima de 60 req/min no IP — 429 com Retry-After, antes de qualquer checagem de segredo", async () => {
    registrarTentativaMock.mockImplementation(async (regra) => (regra === LIMITE_INTEGRACAO_POR_IP ? bloqueado : { permitido: true, contagem: 1, retryAfterSegundos: 60 }));
    const res = await POST(requisicao(corpoValido(), undefined, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(registrarTentativaMock).toHaveBeenCalledWith(LIMITE_INTEGRACAO_POR_IP, "203.0.113.7");
    expect(registrarTentativaMock).not.toHaveBeenCalledWith(LIMITE_INTEGRACAO_FALHA_AUTH, expect.anything());
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("10 falhas de autenticação em 15 min no IP — 429 MESMO com o segredo certo (o segredo nem é comparado)", async () => {
    registrarTentativaMock.mockImplementation(async (regra) => (regra === LIMITE_INTEGRACAO_FALHA_AUTH ? bloqueado : { permitido: true, contagem: 1, retryAfterSegundos: 60 }));
    const res = await POST(requisicao(corpoValido()));

    expect(res.status).toBe(429);
    expect(queryMock).not.toHaveBeenCalled();
    expect(desfazerTentativaMock).not.toHaveBeenCalled();
  });

  it("segredo errado — 401 genérico e a falha FICA contada (não desfaz)", async () => {
    const res = await POST(requisicao(corpoValido(), "Bearer errado"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ erro: "Não autorizado." });
    expect(registrarTentativaMock).toHaveBeenCalledWith(LIMITE_INTEGRACAO_FALHA_AUTH, expect.any(String));
    expect(desfazerTentativaMock).not.toHaveBeenCalled();
  });

  it("segredo certo — a tentativa de autenticação é devolvida (só falha acumula)", async () => {
    queryMock.mockResolvedValue([{ id: "cliente-novo", criado: true }]);
    const res = await POST(requisicao(corpoValido(), undefined, { "x-forwarded-for": "198.51.100.4" }));
    expect(res.status).toBe(200);
    expect(desfazerTentativaMock).toHaveBeenCalledWith(LIMITE_INTEGRACAO_FALHA_AUTH, "198.51.100.4");
  });

  it("segredo com comprimento muito diferente do esperado — 401, nunca lança", async () => {
    const res = await POST(requisicao(corpoValido(), `Bearer ${"x".repeat(5000)}`));
    expect(res.status).toBe(401);
  });
});
