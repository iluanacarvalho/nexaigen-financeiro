// Testes unitários de POST /api/integracao/clientes (nexaigen-educa →
// Financeiro). Mocka @/lib/db, @/lib/armazenamentoObjetos e
// @/lib/alertaErroSistema — nunca Postgres, bucket ou Resend reais. O
// upsert de verdade (índice único parcial + ON CONFLICT) é exercitado
// contra Postgres real em route.integration.test.ts.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, uploadArquivoMock, alertarErroSistemaMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  uploadArquivoMock: vi.fn(),
  alertarErroSistemaMock: vi.fn()
}));
vi.mock("@/lib/db", () => ({ query: queryMock }));
vi.mock("@/lib/armazenamentoObjetos", () => ({ uploadArquivo: uploadArquivoMock, gerarUrlDownload: vi.fn() }));
vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: alertarErroSistemaMock }));

import { NextRequest } from "next/server";
import { POST } from "./route";

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

function requisicao(corpo: unknown, auth: string | null = `Bearer ${SEGREDO}`): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
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
  uploadArquivoMock.mockReset();
  alertarErroSistemaMock.mockReset();
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
    expect(uploadArquivoMock).not.toHaveBeenCalled();
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
    expect(params[15]).toBeNull();
    expect(params[16]).toBeNull();
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
    expect(uploadArquivoMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("PDF maior que 10MB depois de decodificado — 400", async () => {
    const grande = Buffer.alloc(10 * 1024 * 1024 + 1);
    grande.write("%PDF-");
    const res = await POST(
      requisicao(corpoValido({ contratoArquivoBase64: grande.toString("base64"), contratoArquivoNome: "grande.pdf" }))
    );
    expect(res.status).toBe(400);
    expect(uploadArquivoMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("contrato válido — faz upload no prefixo financeiro/contratos-prefeitura/{uuid}/ e grava chave/nome", async () => {
    uploadArquivoMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([{ id: "cliente-novo", criado: true }]);

    const res = await POST(
      requisicao(corpoValido({ contratoArquivoBase64: PDF_BASE64, contratoArquivoNome: "Contrato Jaguapitã 2026.pdf" }))
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "cliente-novo", criado: true });

    const [chave, buffer, tipo] = uploadArquivoMock.mock.calls[0];
    expect(chave).toMatch(/^financeiro\/contratos-prefeitura\/[0-9a-f-]{36}\/Contrato_Jaguapit__2026\.pdf$/);
    expect((buffer as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    expect(tipo).toBe("application/pdf");

    const [, params] = chamadaUpsert()!;
    expect(params[15]).toBe(chave);
    expect(params[16]).toBe("Contrato Jaguapitã 2026.pdf");
  });

  it("falha no upload do contrato NÃO derruba o cadastro — cliente salvo sem contrato + avisoContrato", async () => {
    uploadArquivoMock.mockResolvedValue(false);
    queryMock.mockResolvedValue([{ id: "cliente-novo", criado: true }]);

    const res = await POST(requisicao(corpoValido({ contratoArquivoBase64: PDF_BASE64, contratoArquivoNome: "contrato.pdf" })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "cliente-novo", criado: true, avisoContrato: "não foi possível salvar o contrato anexado" });
    const [, params] = chamadaUpsert()!;
    expect(params[15]).toBeNull();
    expect(params[16]).toBeNull();
  });
});
