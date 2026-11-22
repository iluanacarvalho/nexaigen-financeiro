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

const { queryMock, withTransactionMock, trocarSenhaMock, servicoNotas, servicoCancelamento, servicoCrm } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  withTransactionMock: vi.fn(),
  trocarSenhaMock: vi.fn(),
  servicoNotas: {
    criarNota: vi.fn(),
    listarNotas: vi.fn(),
    executarAcaoNota: vi.fn(),
    registrarVerificacaoSemMudanca: vi.fn()
  },
  servicoCancelamento: {
    registrarCancelamento: vi.fn(),
    retratarCancelamento: vi.fn(),
    encerrarContrato: vi.fn(),
    clientePorMunicipio: vi.fn()
  },
  servicoCrm: {
    criarLead: vi.fn(),
    editarLead: vi.fn(),
    registrarInteracao: vi.fn(),
    mudarEtapa: vi.fn(),
    trocarVendedor: vi.fn(),
    pedirLead: vi.fn(),
    decidirPedido: vi.fn(),
    listarLeads: vi.fn(),
    consultarLeads: vi.fn()
  }
}));
vi.mock("@/lib/db", () => ({ query: queryMock, withTransaction: withTransactionMock, consultasJuntas: (_e: unknown, tarefas: (() => Promise<unknown>)[]) => Promise.all(tarefas.map((t) => t())) }));
vi.mock("@/lib/rateLimit", async (original) => ({
  ...(await original<typeof import("@/lib/rateLimit")>()),
  registrarTentativa: vi.fn(async () => ({ permitido: true, contagem: 1, retryAfterSegundos: 60 })),
  desfazerTentativa: vi.fn(async () => undefined),
  zerarContador: vi.fn(async () => undefined)
}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), trocarSenha: trocarSenhaMock }));
vi.mock("@/lib/notasServico", async (original) => ({ ...(await original<typeof import("@/lib/notasServico")>()), ...servicoNotas }));
vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));
vi.mock("@/lib/cancelamentoServico", async (original) => ({ ...(await original<typeof import("@/lib/cancelamentoServico")>()), ...servicoCancelamento }));
vi.mock("@/lib/crmServico", async (original) => ({
  ...(await original<typeof import("@/lib/crmServico")>()),
  criarLead: servicoCrm.criarLead,
  editarLead: servicoCrm.editarLead,
  registrarInteracao: servicoCrm.registrarInteracao,
  mudarEtapa: servicoCrm.mudarEtapa,
  trocarVendedor: servicoCrm.trocarVendedor,
  decidirPedido: servicoCrm.decidirPedido
}));
vi.mock("@/lib/crmRepositorio", async (original) => ({
  ...(await original<typeof import("@/lib/crmRepositorio")>()),
  listarLeads: servicoCrm.listarLeads,
  consultarLeads: servicoCrm.consultarLeads
}));
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
import { POST as REGISTRAR_CANCELAMENTO } from "./clientes/[id]/cancelamento/route";
import { POST as INTEGRACAO_CANCELAMENTO } from "./integracao/clientes/[municipioIdExterno]/cancelamento/route";
import { PATCH as ALTERAR_PAPEL } from "./equipe/[id]/route";
import { GET as RELATORIO_CONTRATOS } from "./relatorios/novos-contratos/route";
import { PUT as DIVULGACAO } from "./clientes/[id]/divulgacao/route";
import { GET as LISTAR_LEADS, POST as CRIAR_LEAD } from "./leads/route";
import { PATCH as EDITAR_LEAD } from "./leads/[id]/route";
import { POST as INTERACAO_LEAD } from "./leads/[id]/interacoes/route";
import { POST as ETAPA_LEAD } from "./leads/[id]/etapa/route";
import { POST as VENDEDOR_LEAD } from "./leads/[id]/vendedor/route";
import { GET as CONSULTA_LEADS } from "./leads/consulta/route";
import { POST as DECISAO_PEDIDO } from "./leads/pedidos/[id]/route";

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
    if (sql.includes("select token_version, ativo, papel from equipe_nexaigen")) return [{ token_version: 1, ativo: true, papel: "admin" }];
    if (sql.includes("insert into cliente_prefeitura")) return [{ id: ID, criado: true }];
    if (sql.includes("update cliente_prefeitura")) return [{ id: ID }];
    if (sql.includes("insert into equipe_nexaigen")) return [{ id: ID }];
    if (sql.includes("from cliente_prefeitura c") || sql.includes("from cliente_evento_contrato")) return [];
    return [];
  });
  trocarSenhaMock.mockResolvedValue({ sucesso: true });
  servicoNotas.criarNota.mockResolvedValue({ ok: true, id: ID });
  servicoNotas.listarNotas.mockResolvedValue({ notas: [], total: 0 });
  servicoNotas.executarAcaoNota.mockResolvedValue({ ok: true, statusAnterior: "atestada", statusNovo: "paga" });
  servicoNotas.registrarVerificacaoSemMudanca.mockResolvedValue(true);
  const contratoOk = { ok: true, mudou: true, clienteId: ID, statusContrato: "em_aviso_previo", pedidoEm: "2026-10-01", terminoEm: "2026-10-31" };
  servicoCancelamento.registrarCancelamento.mockResolvedValue(contratoOk);
  servicoCancelamento.retratarCancelamento.mockResolvedValue({ ...contratoOk, statusContrato: "ativo" });
  servicoCancelamento.encerrarContrato.mockResolvedValue({ ...contratoOk, statusContrato: "encerrado" });
  servicoCancelamento.clientePorMunicipio.mockResolvedValue(ID);
  servicoCrm.criarLead.mockResolvedValue({ ok: true, id: ID });
  servicoCrm.editarLead.mockResolvedValue({ ok: true, versao: 2, alterados: ["contato_nome"] });
  servicoCrm.registrarInteracao.mockResolvedValue({ ok: true, interacaoId: ID });
  servicoCrm.mudarEtapa.mockResolvedValue({ ok: true, etapa: "contato", versao: 2 });
  servicoCrm.trocarVendedor.mockResolvedValue({ ok: true, versao: 2 });
  servicoCrm.decidirPedido.mockResolvedValue({ ok: true, decisao: "negado", negadosAutomaticamente: 0 });
  servicoCrm.listarLeads.mockResolvedValue({ leads: [], total: 0 });
  servicoCrm.consultarLeads.mockResolvedValue({ leads: [], total: 0 });
  process.env.INTEGRACAO_SECRET = SEGREDO_INTEGRACAO;
  cookie = `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId: ID, nome: "Teste", precisaTrocarSenha: false, tokenVersion: 1 })}`;
});

describe("POST /api/auth/login (sem `detalhes` por desenho — nunca revela qual campo)", { timeout: 30_000 }, () => {
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

describe("POST /api/auth/trocar-senha", { timeout: 30_000 }, () => {
  it("(a) válido passa", async () => {
    await naoFoiErroDeValidacao(await chamar(TROCAR_SENHA, "POST", { senha_atual: "atual", nova_senha: "novaSenha1" }));
  });
  it("(b) nova senha fraca → 400 com as mensagens do projeto em fieldErrors.nova_senha", async () => {
    const d = await esperar400ComDetalhes(await chamar(TROCAR_SENHA, "POST", { senha_atual: "atual", nova_senha: "curta" }));
    expect(d.fieldErrors.nova_senha).toEqual(["A nova senha precisa de pelo menos 8 caracteres.", "A nova senha precisa de pelo menos um número."]);
  });
});

describe("POST /api/equipe", { timeout: 30_000 }, () => {
  it("(a) válido passa — e o e-mail com espaços nas pontas é aparado ANTES de validar o formato", async () => {
    const res = await chamar(EQUIPE, "POST", { nome: "Nova Pessoa", email: "  Nova.Pessoa@nexaigen.com.br  ", papel: "financeiro" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "nova.pessoa@nexaigen.com.br", papel: "financeiro" });
  });
  it("(b) sem papel ou papel inexistente → 400 em fieldErrors.papel (nunca um papel default silencioso)", async () => {
    const sem = await esperar400ComDetalhes(await chamar(EQUIPE, "POST", { nome: "Nova Pessoa", email: "a@b.com.br" }));
    expect(sem.fieldErrors.papel).toEqual(["Papel inválido — use um destes: admin, financeiro, vendas, rh, contratos, implantacao."]);
    const outro = await esperar400ComDetalhes(await chamar(EQUIPE, "POST", { nome: "Nova Pessoa", email: "a@b.com.br", papel: "diretor" }));
    expect(outro.fieldErrors.papel).toHaveLength(1);
  });
  it("(b) e-mail inválido → 400, fieldErrors.email = ['E-mail inválido.']", async () => {
    const d = await esperar400ComDetalhes(await chamar(EQUIPE, "POST", { nome: "Nova Pessoa", email: "sem-arroba", papel: "rh" }));
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

describe("POST /api/clientes/[id]/cancelamento (estrito)", () => {
  it("(a) válido passa", async () => {
    expect((await chamar(REGISTRAR_CANCELAMENTO, "POST", { dataPedido: "2026-10-01", motivo: "Ofício 12" })).status).toBe(200);
  });
  it("(b) data em outro formato / inexistente e motivo vazio → 400 com fieldErrors (mensagens do projeto)", async () => {
    const d = await esperar400ComDetalhes(await chamar(REGISTRAR_CANCELAMENTO, "POST", { dataPedido: "01/10/2026", motivo: "  " }));
    expect(d.fieldErrors.dataPedido).toEqual(["Data de recebimento do ofício: use o formato aaaa-mm-dd."]);
    expect(d.fieldErrors.motivo).toEqual(["Informe o motivo do cancelamento."]);
    const inexistente = await esperar400ComDetalhes(await chamar(REGISTRAR_CANCELAMENTO, "POST", { dataPedido: "2026-02-30", motivo: "x" }));
    expect(inexistente.fieldErrors.dataPedido).toEqual(["Data de recebimento do ofício: data que não existe no calendário."]);
  });
  it("(c) chave desconhecida → 400 (autor nunca vem do corpo)", async () => {
    const d = await esperar400ComDetalhes(await chamar(REGISTRAR_CANCELAMENTO, "POST", { dataPedido: "2026-10-01", motivo: "x", equipe_id: ID }));
    expect(d.formErrors.join(" ")).toContain("equipe_id");
  });
});

describe("POST /api/integracao/clientes/[municipioIdExterno]/cancelamento (estrito)", () => {
  function chamarIntegracao(corpo: unknown) {
    return INTEGRACAO_CANCELAMENTO(
      new NextRequest(`http://localhost:3001/api/integracao/clientes/${ID}/cancelamento`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SEGREDO_INTEGRACAO}` },
        body: JSON.stringify(corpo)
      }),
      { params: Promise.resolve({ municipioIdExterno: ID }) }
    );
  }
  it("(a) as três ações válidas passam", async () => {
    expect((await chamarIntegracao({ acao: "registrar", dataPedido: "2026-10-01", motivo: "Ofício" })).status).toBe(200);
    expect((await chamarIntegracao({ acao: "retratar" })).status).toBe(200);
    expect((await chamarIntegracao({ acao: "encerrar", imediato: true })).status).toBe(200);
  });
  it("(b) registrar sem dataPedido, imediato fora de encerrar, ação inexistente → 400 com fieldErrors", async () => {
    const semData = await esperar400ComDetalhes(await chamarIntegracao({ acao: "registrar" }));
    expect(semData.fieldErrors.dataPedido).toEqual(["Informe dataPedido (data de recebimento do ofício) para registrar o cancelamento."]);
    const imediato = await esperar400ComDetalhes(await chamarIntegracao({ acao: "retratar", imediato: true }));
    expect(imediato.fieldErrors.imediato).toEqual(["imediato só vale para acao 'encerrar'."]);
    const acao = await esperar400ComDetalhes(await chamarIntegracao({ acao: "apagar" }));
    expect(acao.fieldErrors.acao).toEqual(["acao inválida — use: registrar, retratar, encerrar."]);
  });
  it("(c) chave desconhecida → 400", async () => {
    const d = await esperar400ComDetalhes(await chamarIntegracao({ acao: "retratar", status: "ativo" }));
    expect(d.formErrors.join(" ")).toContain("status");
  });
});

describe("PATCH /api/equipe/[id] (estrito)", () => {
  it("(a) válido passa (serviço chamado)", async () => {
    withTransactionMock.mockResolvedValueOnce({ ok: true, mudou: true, papel: "vendas" });
    const res = await chamar(ALTERAR_PAPEL, "PATCH", { papel: "vendas" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ papel: "vendas", mudou: true, sessaoEncerrada: true });
  });
  it("(b) papel inválido → 400 em fieldErrors.papel", async () => {
    const d = await esperar400ComDetalhes(await chamar(ALTERAR_PAPEL, "PATCH", { papel: "dono" }));
    expect(d.fieldErrors.papel).toEqual(["Papel inválido — use um destes: admin, financeiro, vendas, rh, contratos, implantacao."]);
  });
  it("(c) chave desconhecida → 400 (só o papel muda por aqui)", async () => {
    const d = await esperar400ComDetalhes(await chamar(ALTERAR_PAPEL, "PATCH", { papel: "rh", ativo: false }));
    expect(d.formErrors.join(" ")).toContain("ativo");
  });
});

describe("GET /api/relatorios/novos-contratos (query estrita)", () => {
  const url = (q: string) => ({ url: `/api/relatorios/novos-contratos${q}` });
  it("(a) válido passa — mês 2026-01 e formatos", async () => {
    expect((await chamar(RELATORIO_CONTRATOS, "GET", undefined, url("?mes=2026-01"))).status).toBe(200);
    const csv = await chamar(RELATORIO_CONTRATOS, "GET", undefined, url("?mes=2026-01&formato=csv"));
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  });
  it("(b) mês inválido/futuro e formato inválido → 400 com fieldErrors (mensagens do projeto)", async () => {
    const res = await chamar(RELATORIO_CONTRATOS, "GET", undefined, url("?mes=2026-13"));
    expect(res.status).toBe(400);
    const corpo = await res.json();
    expect(corpo.erro).toBe("Filtros inválidos");
    conferirFormato(corpo.detalhes);
    expect(corpo.detalhes.fieldErrors.mes).toEqual(["Mês inválido — use aaaa-mm."]);
    expect((await (await chamar(RELATORIO_CONTRATOS, "GET", undefined, url("?mes=2999-01"))).json()).detalhes.fieldErrors.mes).toEqual(["Esse mês ainda não chegou."]);
    expect((await (await chamar(RELATORIO_CONTRATOS, "GET", undefined, url("?formato=pdf"))).json()).detalhes.fieldErrors.formato).toEqual(["formato inválido — use json, csv ou xlsx."]);
  });
  it("(c) parâmetro desconhecido → 400", async () => {
    const res = await chamar(RELATORIO_CONTRATOS, "GET", undefined, url("?mes=2026-01&cliente=1"));
    expect(res.status).toBe(400);
    expect((await res.json()).detalhes.formErrors.join(" ")).toContain("cliente");
  });
});

describe("PUT /api/clientes/[id]/divulgacao (estrito, união por acao)", () => {
  it("(a) válidos passam da validação (autorizar/revogar chegam ao serviço; limpar o código não consulta o IBGE)", async () => {
    withTransactionMock.mockResolvedValue({ ok: true, nome: "Prefeitura X", uf: "PR" });
    expect((await chamar(DIVULGACAO, "PUT", { acao: "autorizar" })).status).toBe(200);
    expect((await chamar(DIVULGACAO, "PUT", { acao: "revogar" })).status).toBe(200);
    const limpar = await chamar(DIVULGACAO, "PUT", { acao: "definir_codigo", codigoIbge: null });
    expect(limpar.status).toBe(200);
    expect(await limpar.json()).toEqual({ codigoIbge: null, posicao: null, ibge: null, confere: null });
  });
  it("(b) código com formato errado e acao inexistente → 400 com fieldErrors (mensagens do projeto)", async () => {
    const d = await esperar400ComDetalhes(await chamar(DIVULGACAO, "PUT", { acao: "definir_codigo", codigoIbge: "41069" }));
    expect(d.fieldErrors.codigoIbge).toEqual(["O código IBGE do município tem exatamente 7 dígitos."]);
    const acao = await esperar400ComDetalhes(await chamar(DIVULGACAO, "PUT", { acao: "publicar" }));
    expect(acao.fieldErrors.acao).toEqual(["acao inválida — use definir_codigo, autorizar ou revogar."]);
  });
  it("(c) chave desconhecida → 400 (quem autoriza nunca vem do corpo)", async () => {
    const d = await esperar400ComDetalhes(await chamar(DIVULGACAO, "PUT", { acao: "autorizar", autorizacao_divulgacao_por: ID }));
    expect(d.formErrors.join(" ")).toContain("autorizacao_divulgacao_por");
  });
});

describe("CRM — rotas com corpo/query validados (rodada 16-A, objetos estritos)", () => {
  const lead = { municipio_nome: "Jaguapitã", uf: "PR", origem: "indicacao" };

  it("(a) válidos passam: criar (valor como texto → centavos), editar, interação, etapa (3 ações), vendedor, decisão, listagem, consulta", async () => {
    expect((await chamar(CRIAR_LEAD, "POST", { ...lead, plano_interesse: "pequeno_porte", valor_mensal_estimado: "8500,00" })).status).toBe(201);
    expect(servicoCrm.criarLead.mock.calls.at(-1)![0]).toMatchObject({ valor_mensal_estimado_centavos: 850000, plano_interesse: "pequeno_porte" });
    expect((await chamar(EDITAR_LEAD, "PATCH", { versao: 1, contato_nome: "Fulana" })).status).toBe(200);
    expect((await chamar(INTERACAO_LEAD, "POST", { tipo: "ligacao", texto: "Ligou para a secretaria" })).status).toBe(201);
    for (const corpo of [{ acao: "mover", etapa: "contato" }, { acao: "perder", motivo: "preco", detalhe: "caro" }, { acao: "reabrir" }]) {
      expect((await chamar(ETAPA_LEAD, "POST", corpo)).status).toBe(200);
    }
    expect((await chamar(VENDEDOR_LEAD, "POST", { vendedor_id: ID })).status).toBe(200);
    expect((await chamar(DECISAO_PEDIDO, "POST", { decisao: "negado" })).status).toBe(200);
    expect((await chamar(LISTAR_LEADS, "GET", undefined, { url: "/api/leads?etapa=contato&uf=PR&parados=true&ordenar=valor&por_pagina=100" })).status).toBe(200);
    expect((await chamar(CONSULTA_LEADS, "GET", undefined, { url: "/api/leads/consulta?busca=jaguapita&codigo_ibge=4112207" })).status).toBe(200);
  });

  it("(b) inválidos → 400 com as mensagens do projeto em fieldErrors", async () => {
    const criar = await esperar400ComDetalhes(await chamar(CRIAR_LEAD, "POST", { municipio_nome: "J", uf: "XX", origem: "panfleto", contato_email: "sem-arroba", valor_mensal_estimado: 8500 }));
    expect(criar.fieldErrors.municipio_nome).toEqual(["Informe o município."]);
    expect(criar.fieldErrors.uf).toEqual(["UF inválida."]);
    expect(criar.fieldErrors.origem).toEqual(["Origem inválida — use: indicacao, evento, site, contato_direto, outro."]);
    expect(criar.fieldErrors.contato_email).toEqual(["E-mail inválido."]);
    expect(criar.fieldErrors.valor_mensal_estimado).toHaveLength(1); // número do JSON: recusado (dinheiro é texto)
    const semData = await esperar400ComDetalhes(await chamar(CRIAR_LEAD, "POST", { ...lead, proxima_acao_descricao: "ligar" }));
    expect(semData.fieldErrors.proxima_acao_descricao).toEqual(["Informe a data da próxima ação junto com a descrição."]);
    const semVersao = await esperar400ComDetalhes(await chamar(EDITAR_LEAD, "PATCH", { contato_nome: "x" }));
    expect(semVersao.fieldErrors.versao).toEqual(["Envie a versão do lead que você leu."]);
    const perder = await esperar400ComDetalhes(await chamar(ETAPA_LEAD, "POST", { acao: "perder" }));
    expect(perder.fieldErrors.motivo).toEqual(["Informe o motivo da perda: preco, sem_orcamento, concorrente, sem_interesse, sem_resposta, outro."]);
    const interacao = await esperar400ComDetalhes(await chamar(INTERACAO_LEAD, "POST", { tipo: "mudanca_etapa", texto: "" }));
    expect(interacao.fieldErrors.tipo).toEqual(["Tipo inválido — use: nota, ligacao, email, reuniao, whatsapp, visita."]);
    expect(interacao.fieldErrors.texto).toEqual(["Escreva o que aconteceu."]);
    const pagina = await chamar(LISTAR_LEADS, "GET", undefined, { url: "/api/leads?por_pagina=101" });
    expect(pagina.status).toBe(400);
    expect((await pagina.json()).detalhes.fieldErrors.por_pagina).toEqual(["No máximo 100 por página."]);
    const consulta = await chamar(CONSULTA_LEADS, "GET", undefined, { url: "/api/leads/consulta" });
    expect((await consulta.json()).detalhes.formErrors).toEqual(["Informe o município, a UF ou o código IBGE."]);
  });

  it("(c) chave desconhecida → 400: etapa/vendedor/motivo NÃO entram pelo PATCH; vendedor não entra pela interação", async () => {
    for (const extra of [{ etapa: "ganho" }, { vendedor_id: ID }, { motivo_perda: "preco" }]) {
      const d = await esperar400ComDetalhes(await chamar(EDITAR_LEAD, "PATCH", { versao: 1, ...extra }));
      expect(d.formErrors.join(" ")).toContain(Object.keys(extra)[0]);
    }
    const d = await esperar400ComDetalhes(await chamar(INTERACAO_LEAD, "POST", { tipo: "nota", texto: "x", autor_id: ID }));
    expect(d.formErrors.join(" ")).toContain("autor_id");
    expect((await chamar(LISTAR_LEADS, "GET", undefined, { url: "/api/leads?senha=1" })).status).toBe(400);
  });
});
