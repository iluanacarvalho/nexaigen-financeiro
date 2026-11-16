// Regressão de CONTRATO da validação (rodada 10-A — zod 3 → zod 4). Para
// CADA rota que valida corpo/query com Zod:
//   (a) payload válido passa da validação (nunca volta "Dados inválidos");
//   (b) payload inválido → 400 com `detalhes` EXATAMENTE no formato de antes
//       ({ formErrors: string[], fieldErrors: { campo: string[] } } — o do
//       antigo `.flatten()`), com as mensagens próprias do projeto intactas;
//   (c) schema estrito: chave desconhecida → 400 (nunca ignorada em silêncio).
// Banco, rate limit e serviços mockados — o alvo aqui é só a fronteira de
// validação. Sessão REAL (gerarAccessToken) nas rotas que exigem sessão.

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "chave-de-teste-jwt-apenas-unitario";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, withTransactionMock, trocarSenhaMock, servicoNotas } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  withTransactionMock: vi.fn(),
  trocarSenhaMock: vi.fn(),
  servicoNotas: {
    criarNota: vi.fn(),
    listarNotas: vi.fn(),
    executarAcaoNota: vi.fn(),
    registrarVerificacaoSemMudanca: vi.fn()
  }
}));
vi.mock("@/lib/db", () => ({ query: queryMock, withTransaction: withTransactionMock }));
vi.mock("@/lib/rateLimit", async (original) => ({
  ...(await original<typeof import("@/lib/rateLimit")>()),
  registrarTentativa: vi.fn(async () => ({ permitido: true, contagem: 1, retryAfterSegundos: 60 })),
  desfazerTentativa: vi.fn(async () => undefined),
  zerarContador: vi.fn(async () => undefined)
}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), trocarSenha: trocarSenhaMock }));
vi.mock("@/lib/notasServico", async (original) => ({ ...(await original<typeof import("@/lib/notasServico")>()), ...servicoNotas }));
vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));
vi.mock("@/lib/versionamentoPdf", async (original) => ({ ...(await original<typeof import("@/lib/versionamentoPdf")>()), registrarVersaoPdf: vi.fn() }));

import { NextRequest } from "next/server";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { POST as LOGIN } from "./auth/login/route";
import { POST as TROCAR_SENHA } from "./auth/trocar-senha/route";
import { POST as EQUIPE } from "./equipe/route";
import { POST as CRIAR_CLIENTE } from "./clientes/route";
import { PATCH as EDITAR_CLIENTE } from "./clientes/[id]/route";
import { GET as LISTAR_NOTAS, POST as CRIAR_NOTA } from "./notas/route";
import { POST as ACAO_NOTA } from "./notas/[id]/acoes/route";
import { POST as VERIFICAR } from "./notas/[id]/verificar/route";
import { POST as INTEGRACAO } from "./integracao/clientes/route";

const ID = "7a1b2c3d-0000-4000-8000-0000000000aa";
const SEGREDO_INTEGRACAO = "segredo-contrato-validacao";
let cookie: string;

type Rota = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function chamar(rota: Rota, metodo: string, corpo?: unknown, opts: { url?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", cookie, ...opts.headers };
  const req = new NextRequest(`http://localhost:3001${opts.url ?? "/api/x"}`, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  return rota(req, { params: Promise.resolve({ id: ID }) });
}

/** Formato EXATO do `detalhes` (o do antigo `.flatten()`): só essas duas chaves, arrays de string. */
function conferirFormato(detalhes: unknown) {
  expect(Object.keys(detalhes as object).sort()).toEqual(["fieldErrors", "formErrors"]);
  const d = detalhes as { formErrors: unknown; fieldErrors: Record<string, unknown> };
  expect(Array.isArray(d.formErrors)).toBe(true);
  for (const m of d.formErrors as unknown[]) expect(typeof m).toBe("string");
  for (const mensagens of Object.values(d.fieldErrors)) {
    expect(Array.isArray(mensagens)).toBe(true);
    for (const m of mensagens as unknown[]) expect(typeof m).toBe("string");
  }
}

async function esperar400ComDetalhes(res: Response) {
  expect(res.status).toBe(400);
  const corpo = await res.json();
  expect(corpo.erro).toMatch(/inválid/);
  conferirFormato(corpo.detalhes);
  return corpo.detalhes as { formErrors: string[]; fieldErrors: Record<string, string[]> };
}

async function naoFoiErroDeValidacao(res: Response) {
  const corpo = await res.clone().json().catch(() => ({}));
  expect(corpo.erro === "Dados inválidos" || corpo.erro === "Filtros inválidos").toBe(false);
  expect(corpo.detalhes).toBeUndefined();
}

beforeEach(async () => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("select token_version, ativo from equipe_nexaigen")) return [{ token_version: 1, ativo: true }];
    if (sql.includes("insert into cliente_prefeitura")) return [{ id: ID, criado: true }];
    if (sql.includes("update cliente_prefeitura")) return [{ id: ID }];
    if (sql.includes("insert into equipe_nexaigen")) return [{ id: ID }];
    return [];
  });
  trocarSenhaMock.mockResolvedValue({ sucesso: true });
  servicoNotas.criarNota.mockResolvedValue({ ok: true, id: ID });
  servicoNotas.listarNotas.mockResolvedValue({ notas: [], total: 0 });
  servicoNotas.executarAcaoNota.mockResolvedValue({ ok: true, statusAnterior: "atestada", statusNovo: "paga" });
  servicoNotas.registrarVerificacaoSemMudanca.mockResolvedValue(true);
  process.env.INTEGRACAO_SECRET = SEGREDO_INTEGRACAO;
  cookie = `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId: ID, nome: "Teste", precisaTrocarSenha: false, tokenVersion: 1 })}`;
});

describe("POST /api/auth/login (sem `detalhes` por desenho — nunca revela qual campo)", () => {
  it("(a) válido passa da validação (conta inexistente → 401, não 400)", async () => {
    const res = await chamar(LOGIN, "POST", { email: "pessoa@exemplo.com.br", senha: "x" });
    expect(res.status).toBe(401);
  });
  it("(b) e-mail inválido → 400 genérico, sem detalhes", async () => {
    const res = await chamar(LOGIN, "POST", { email: "nao-e-email", senha: "x" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erro: "Dados inválidos" });
  });
});

describe("POST /api/auth/trocar-senha", () => {
  it("(a) válido passa", async () => {
    await naoFoiErroDeValidacao(await chamar(TROCAR_SENHA, "POST", { senha_atual: "atual", nova_senha: "novaSenha1" }));
  });
  it("(b) nova senha fraca → 400 com as mensagens do projeto em fieldErrors.nova_senha", async () => {
    const d = await esperar400ComDetalhes(await chamar(TROCAR_SENHA, "POST", { senha_atual: "atual", nova_senha: "curta" }));
    expect(d.fieldErrors.nova_senha).toEqual(["A nova senha precisa de pelo menos 8 caracteres.", "A nova senha precisa de pelo menos um número."]);
  });
});

describe("POST /api/equipe", () => {
  it("(a) válido passa — e o e-mail com espaços nas pontas é aparado ANTES de validar o formato", async () => {
    const res = await chamar(EQUIPE, "POST", { nome: "Nova Pessoa", email: "  Nova.Pessoa@nexaigen.com.br  " });
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe("nova.pessoa@nexaigen.com.br");
  });
  it("(b) e-mail inválido → 400, fieldErrors.email = ['E-mail inválido.']", async () => {
    const d = await esperar400ComDetalhes(await chamar(EQUIPE, "POST", { nome: "Nova Pessoa", email: "sem-arroba" }));
    expect(d.fieldErrors.email).toEqual(["E-mail inválido."]);
  });
});

describe("POST /api/clientes (criação — não estrito por contrato: chave extra é descartada)", () => {
  const valido = { nome: "Prefeitura X", uf: "PR", plano: "pequeno_porte", data_inicio_contrato: "2026-01-01" };
  const paramsInsert = () => queryMock.mock.calls.find((c) => (c[0] as string).includes("insert into cliente_prefeitura"))![1] as unknown[];
  it("(a) válido passa e aplica os padrões do plano na criação (mensalidade e taxa do Pequeno Porte, dia 1)", async () => {
    expect((await chamar(CRIAR_CLIENTE, "POST", valido)).status).toBe(200);
    const params = paramsInsert();
    expect(params[3]).toBe("pequeno_porte");
    expect(params[4]).toBe("8500.00");
    expect(params[5]).toBe(1);
    expect(params[14]).toBe("15000.00");
  });
  it("(a) valor e taxa enviados (texto) valem como vieram — o servidor não força o padrão", async () => {
    expect((await chamar(CRIAR_CLIENTE, "POST", { ...valido, valor_mensal: "7999,90", taxa_implantacao: "10000" })).status).toBe(200);
    expect(paramsInsert()[4]).toBe("7999.90");
    expect(paramsInsert()[14]).toBe("10000.00");
  });
  it("(b) data e URL inválidas → 400 com as mensagens do projeto", async () => {
    const d = await esperar400ComDetalhes(await chamar(CRIAR_CLIENTE, "POST", { ...valido, data_inicio_contrato: "01/01/2026", portal_url: "javascript:alert(1)" }));
    expect(d.fieldErrors.data_inicio_contrato).toEqual(["Use o formato YYYY-MM-DD."]);
    expect(d.fieldErrors.portal_url).toEqual(["Use um endereço http:// ou https://."]);
  });
  it("(b) plano ausente, plano descontinuado, valor float, Dispensa com taxa → 400 com fieldErrors", async () => {
    const semPlano = await esperar400ComDetalhes(await chamar(CRIAR_CLIENTE, "POST", { ...valido, plano: undefined }));
    expect(semPlano.fieldErrors.plano).toHaveLength(1);
    const antigo = await esperar400ComDetalhes(await chamar(CRIAR_CLIENTE, "POST", { ...valido, plano: "essencial" }));
    expect(antigo.fieldErrors.plano[0]).toMatch(/descontinuado/);
    const float = await esperar400ComDetalhes(await chamar(CRIAR_CLIENTE, "POST", { ...valido, valor_mensal: 8500.5 }));
    expect(float.fieldErrors.valor_mensal).toHaveLength(1);
    const dispensa = await esperar400ComDetalhes(await chamar(CRIAR_CLIENTE, "POST", { ...valido, plano: "dispensa", taxa_implantacao: "100" }));
    expect(dispensa.fieldErrors.taxa_implantacao[0]).toMatch(/Dispensa não tem taxa/);
  });
  it("chave extra é descartada (contrato de sempre desta rota), não vira 400", async () => {
    expect((await chamar(CRIAR_CLIENTE, "POST", { ...valido, campo_que_nao_existe: 1 })).status).toBe(200);
  });
});

describe("PATCH /api/clientes/[id] (estrito)", () => {
  it("(a) válido passa — e SÓ o campo enviado vai pro UPDATE (nenhum default do zod 4 aplicado)", async () => {
    expect((await chamar(EDITAR_CLIENTE, "PATCH", { observacao: "x" })).status).toBe(200);
    const [sql] = queryMock.mock.calls.find((c) => (c[0] as string).includes("update cliente_prefeitura"))!;
    expect(sql).toContain("set observacao = $1 where");
  });
  it("(b) inválido → 400 com fieldErrors; PATCH vazio → formErrors", async () => {
    const d = await esperar400ComDetalhes(await chamar(EDITAR_CLIENTE, "PATCH", { valor_mensal: "-1" }));
    expect(Object.keys(d.fieldErrors)).toEqual(["valor_mensal"]);
    const vazio = await esperar400ComDetalhes(await chamar(EDITAR_CLIENTE, "PATCH", {}));
    expect(vazio.formErrors).toEqual(["Envie ao menos um campo para atualizar."]);
  });
  it("(c) chave desconhecida → 400 (nome da chave em formErrors)", async () => {
    const d = await esperar400ComDetalhes(await chamar(EDITAR_CLIENTE, "PATCH", { observacao: "x", municipio_id_externo: ID }));
    expect(d.formErrors.join(" ")).toContain("municipio_id_externo");
  });
});

describe("GET /api/notas (query estrita)", () => {
  it("(a) válido passa", async () => {
    expect((await chamar(LISTAR_NOTAS, "GET", undefined, { url: `/api/notas?situacao=vencida&cliente_id=${ID}&competencia=2026-10&pagina=2` })).status).toBe(200);
  });
  it("(b) inválido → 400 com fieldErrors (mensagens do projeto)", async () => {
    const res = await chamar(LISTAR_NOTAS, "GET", undefined, { url: "/api/notas?competencia=2026-13&por_pagina=101" });
    expect(res.status).toBe(400);
    const corpo = await res.json();
    expect(corpo.erro).toBe("Filtros inválidos");
    conferirFormato(corpo.detalhes);
    expect(corpo.detalhes.fieldErrors.competencia).toEqual(["Mês inválido."]);
    expect(corpo.detalhes.fieldErrors.por_pagina).toHaveLength(1);
  });
  it("(c) parâmetro desconhecido → 400", async () => {
    const res = await chamar(LISTAR_NOTAS, "GET", undefined, { url: "/api/notas?senha_hash=1" });
    expect(res.status).toBe(400);
    expect((await res.json()).detalhes.formErrors.join(" ")).toContain("senha_hash");
  });
});

describe("POST /api/notas (estrito)", () => {
  const valido = { cliente_id: ID, competencia: "2026-10", valor: "100,50" };
  it("(a) válido passa → 201", async () => {
    expect((await chamar(CRIAR_NOTA, "POST", valido)).status).toBe(201);
  });
  it("(b) valor como number (float) → 400 em fieldErrors.valor", async () => {
    const d = await esperar400ComDetalhes(await chamar(CRIAR_NOTA, "POST", { ...valido, valor: 100.5 }));
    expect(d.fieldErrors.valor).toHaveLength(1);
  });
  it("(a) implantação sem competência → competência = mês da emissão; mensalidade sem competência → 400", async () => {
    expect((await chamar(CRIAR_NOTA, "POST", { cliente_id: ID, tipo: "implantacao", valor: "15000", data_emissao: "2026-10-05" })).status).toBe(201);
    expect(servicoNotas.criarNota.mock.calls.at(-1)![0]).toMatchObject({ tipo: "implantacao", competencia: "2026-10-01" });
    const semCompetencia = await esperar400ComDetalhes(await chamar(CRIAR_NOTA, "POST", { cliente_id: ID, valor: "10" }));
    expect(semCompetencia.fieldErrors.competencia).toEqual(["Informe a competência (aaaa-mm)."]);
  });
  it("(b) implantação com competência diferente do mês da emissão → 400; tipo inválido → 400", async () => {
    const d = await esperar400ComDetalhes(await chamar(CRIAR_NOTA, "POST", { cliente_id: ID, tipo: "implantacao", valor: "15000", data_emissao: "2026-10-05", competencia: "2026-09" }));
    expect(d.fieldErrors.competencia[0]).toMatch(/mês da emissão/);
    const tipo = await esperar400ComDetalhes(await chamar(CRIAR_NOTA, "POST", { ...valido, tipo: "multa" }));
    expect(tipo.fieldErrors.tipo).toHaveLength(1);
  });
  it("(c) chave desconhecida → 400", async () => {
    const d = await esperar400ComDetalhes(await chamar(CRIAR_NOTA, "POST", { ...valido, status: "paga" }));
    expect(d.formErrors.join(" ")).toContain("status");
  });
});

describe("POST /api/notas/[id]/acoes (estrito)", () => {
  it("(a) válido passa", async () => {
    expect((await chamar(ACAO_NOTA, "POST", { acao: "registrar_pagamento", data: "2026-10-20" })).status).toBe(200);
  });
  it("(b) ação inexistente → 400 em fieldErrors.acao", async () => {
    const d = await esperar400ComDetalhes(await chamar(ACAO_NOTA, "POST", { acao: "apagar_nota" }));
    expect(d.fieldErrors.acao).toHaveLength(1);
  });
  it("(c) chave desconhecida → 400", async () => {
    const d = await esperar400ComDetalhes(await chamar(ACAO_NOTA, "POST", { acao: "cancelar", motivo: "x", feito_por: ID }));
    expect(d.formErrors.join(" ")).toContain("feito_por");
  });
});

describe("POST /api/notas/[id]/verificar (estrito — verificado_por NUNCA vem do corpo)", () => {
  it("(a) válido passa", async () => {
    expect((await chamar(VERIFICAR, "POST", { resultado: "sem_atesto_ainda", observacao: "conferido" })).status).toBe(200);
  });
  it("(b) resultado inválido → 400 em fieldErrors.resultado", async () => {
    const d = await esperar400ComDetalhes(await chamar(VERIFICAR, "POST", { resultado: "talvez" }));
    expect(d.fieldErrors.resultado).toHaveLength(1);
  });
  it("(c) verificado_por no corpo → 400 (chave desconhecida)", async () => {
    const d = await esperar400ComDetalhes(await chamar(VERIFICAR, "POST", { resultado: "atestada", verificado_por: ID }));
    expect(d.formErrors.join(" ")).toContain("verificado_por");
  });
});

describe("POST /api/integracao/clientes (contrato público com o Educa — não estrito)", () => {
  const auth = { headers: { authorization: `Bearer ${SEGREDO_INTEGRACAO}` } };
  const valido = { municipioIdExterno: ID, nome: "Prefeitura Y", uf: "SP", valorMensal: 2000, dataInicioContrato: "2026-02-01" };
  it("(a) válido passa — plano/dia ausentes chegam NULL ao upsert (nenhum default do zod 4 aplicado)", async () => {
    expect((await chamar(INTEGRACAO, "POST", valido, auth)).status).toBe(200);
    const params = queryMock.mock.calls.find((c) => (c[0] as string).includes("insert into cliente_prefeitura"))![1] as unknown[];
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
  });
  it("(b) inválido → 400 com fieldErrors em camelCase e a mensagem do refine no campo certo", async () => {
    const d = await esperar400ComDetalhes(await chamar(INTEGRACAO, "POST", { ...valido, municipioIdExterno: "nao-uuid", contratoArquivoBase64: "JVBERi0=" }, auth));
    expect(d.fieldErrors.municipioIdExterno).toHaveLength(1);
    expect(d.fieldErrors.contratoArquivoNome).toEqual(["contratoArquivoBase64 e contratoArquivoNome devem vir juntos (ou nenhum dos dois)."]);
  });
});
