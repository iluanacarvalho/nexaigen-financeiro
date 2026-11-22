// FECHAMENTO (rodada 16-B1) com POSTGRES REAL, pelas rotas reais, num banco
// TEMPORÁRIO (testes/bancoTemporario.ts — há DDL: a migration 0017 aplicada
// 2× e triggers de falha simulada; e históricos imutáveis que não podem ser
// apagados depois). Bucket em MEMÓRIA (testes/bucketEmMemoria.ts). Cobre:
//   - migration 0017 2× (CNPJ antigo normalizado, nada apagado);
//   - modelos imutáveis (UPDATE/DELETE bloqueados), nova versão, aprovação;
//   - aceite TRANSACIONAL (falha no meio → nada fica), idempotente,
//     duplicidade com cliente vigente, ex-cliente permitido (mesma linha),
//     vendas só no seu lead, lead sem município, versão velha;
//   - 'aguardando_assinatura' FORA de MRR, Painel, Dashboard, Novos
//     contratos, cron, notas, mapa público e divulgação; Território "em
//     fechamento"; CRM não deixa abrir lead novo;
//   - contrato gerado (faixa de rascunho; aprovado sem faixa; dono do lead;
//     dados faltando);
//   - tarefas: chaves EXATAS por papel, 404 em outro papel, 403 sem área,
//     histórico imutável, ações;
//   - assinatura: PDF inválido / bucket fora / data futura não mudam nada;
//     válida ativa com data_inicio = assinatura e abre a implantação;
//   - endpoint do Educa (chaves exatas, 409 aguardando, 401, 400, 404, rate
//     limit) e o POST de cadastro casando por código IBGE + conclusão
//     automática da implantação.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { bancoLocal, criarBancoTemporario, encerrarBancoTemporario, type BancoTemporario } from "@/testes/bancoTemporario";

vi.mock("@/lib/armazenamentoObjetos", async () => (await import("@/testes/bucketEmMemoria")).armazenamentoEmMemoria);
vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const LOCAL = bancoLocal();
let banco: BancoTemporario | null = null;
if (LOCAL) {
  banco = await criarBancoTemporario("fechamento");
  process.env.DATABASE_URL = banco.url; // ANTES de qualquer import de lib/db
}

const { query } = await import("./db");
const { gerarAccessToken, NOME_COOKIE_ACCESS } = await import("./auth");
const { hojeEmSaoPaulo } = await import("./painelFinanceiro");
const { somarDias } = await import("./estadoNota");
const { obterPainelFinanceiro } = await import("./painelFinanceiroRepositorio");
const { obterResumoDashboard } = await import("./resumoDashboard");
const { obterRelatorioContratos } = await import("./relatorioContratosRepositorio");
const { obterMapaPublico } = await import("./mapaPublicoRepositorio");
const { autorizarDivulgacao } = await import("./divulgacaoServico");
const { carregarLinhas } = await import("./territorioRepositorio");
const { motivoParaPular } = await import("./territorio");
const { bucketEmMemoria } = await import("@/testes/bucketEmMemoria");
const { lerZip } = await import("@/testes/lerZip");
const rotaAceite = await import("@/app/api/leads/[id]/aceite/route");
const rotaEtapa = await import("@/app/api/leads/[id]/etapa/route");
const rotaLeads = await import("@/app/api/leads/route");
const rotaGerar = await import("@/app/api/clientes/[id]/contrato/gerar/route");
const rotaAssinatura = await import("@/app/api/operacao/clientes/[id]/assinatura/route");
const rotaTarefas = await import("@/app/api/operacao/tarefas/route");
const rotaTarefa = await import("@/app/api/operacao/tarefas/[id]/route");
const rotaModelos = await import("@/app/api/modelos-contrato/route");
const rotaAprovar = await import("@/app/api/modelos-contrato/[id]/aprovar/route");
const rotaNotas = await import("@/app/api/notas/route");
const rotaCron = await import("@/app/api/cron/verificar-prazos/route");
const rotaImplantacao = await import("@/app/api/integracao/implantacoes/[chave]/route");
const rotaIntegracao = await import("@/app/api/integracao/clientes/route");
const rotaCancelamentoEduca = await import("@/app/api/integracao/clientes/[municipioIdExterno]/cancelamento/route");
const rotaCancelamento = await import("@/app/api/clientes/[id]/cancelamento/route");

const TEMPO = 60_000;
const HOJE = hojeEmSaoPaulo(new Date());
const SEGREDO_INTEGRACAO = "segredo-de-teste-fechamento";
const SEGREDO_CRON = "segredo-de-teste-cron-fechamento";
const PDF = Buffer.from("%PDF-1.4\n% contrato assinado de teste\n%%EOF\n");

type Pessoa = { id: string; cookie: string };
const p: Record<"admin" | "vera" | "beto" | "contratos" | "contratos2" | "implantacao" | "financeiro" | "rh", Pessoa> = {} as never;
const leads: Record<"maringa" | "londrina" | "cascavel" | "pontaGrossa" | "semCodigo" | "toledo", string> = {} as never;
const clientes: Record<"londrina" | "cascavel" | "maringa", string> = {} as never;

async function pessoa(papel: string, nome: string): Promise<Pessoa> {
  const [e] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria, papel) values ($1, $2, 'x', false, $3) returning id, token_version`,
    [nome, `${papel}-${randomUUID().slice(0, 6)}@teste.invalid`, papel]
  );
  return { id: e.id, cookie: `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId: e.id, nome, precisaTrocarSenha: false, tokenVersion: e.token_version })}` };
}
const pedir = (url: string, cookie: string, metodo = "GET", corpo?: unknown, extra: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3001${url}`, { method: metodo, headers: { cookie, "content-type": "application/json", ...extra }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function inserirLead(nome: string, codigo: string | null, uf: string, vendedor: string, extra: Record<string, unknown> = {}): Promise<string> {
  const colunas = ["municipio_nome", "nome_busca", "uf", "codigo_ibge", "origem", "vendedor_id", "etapa", ...Object.keys(extra)];
  const valores = [nome, nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""), uf, codigo, "site", vendedor, "proposta", ...Object.values(extra)];
  const [l] = await query<{ id: string }>(`insert into lead (${colunas.join(", ")}) values (${colunas.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, valores);
  return l.id;
}

const corpoAceite = (versao: number, extra: Record<string, unknown> = {}) => ({
  versao, plano: "grande_porte", valor_mensal: "35000,00", taxa_implantacao: "30000,00", data_prevista_assinatura: null,
  cnpj: "11.222.333/0001-81", endereco_logradouro: "Av. XV de Novembro", endereco_numero: "701", endereco_complemento: "",
  endereco_bairro: "Centro", endereco_cep: "87013-230", representante_nome: "Prefeito de Teste", representante_cargo: "Prefeito Municipal",
  contato_nome: "Secretária de Teste", contato_cargo: "Secretária de Educação", contato_email: "educacao@prefeitura.invalid", contato_telefone: "(44) 3221-0000", ...extra
});
const aceitar = (cookie: string, leadId: string, corpo: unknown) => rotaAceite.POST(pedir(`/api/leads/${leadId}/aceite`, cookie, "POST", corpo), ctx(leadId));
const versaoDoLead = async (id: string) => (await query<{ versao: number }>(`select versao from lead where id = $1`, [id]))[0].versao;
const gerar = (cookie: string, clienteId: string) => rotaGerar.GET(pedir(`/api/clientes/${clienteId}/contrato/gerar`, cookie), ctx(clienteId));
function assinar(cookie: string, clienteId: string, data: string, arquivo: Buffer = PDF, nome = "contrato-assinado.pdf") {
  const fd = new FormData();
  fd.set("data_assinatura", data);
  fd.set("arquivo", new File([new Uint8Array(arquivo)], nome, { type: "application/pdf" }));
  return rotaAssinatura.POST(new NextRequest(`http://localhost:3001/api/operacao/clientes/${clienteId}/assinatura`, { method: "POST", headers: { cookie }, body: fd }), ctx(clienteId));
}
const tarefas = async (cookie: string, aba = "fila") => rotaTarefas.GET(pedir(`/api/operacao/tarefas?aba=${aba}`, cookie));
const agir = (cookie: string, id: string, corpo: unknown) => rotaTarefa.POST(pedir(`/api/operacao/tarefas/${id}`, cookie, "POST", corpo), ctx(id));
const estado = async (clienteId: string) =>
  (await query<{ status_contrato: string; data_inicio_contrato: string | null; versoes: number }>(
    `select status_contrato, data_inicio_contrato, (select count(*)::int from cliente_contrato_versao v where v.cliente_id = c.id) as versoes from cliente_prefeitura c where id = $1`,
    [clienteId]
  ))[0];

describe.skipIf(!LOCAL)("Fechamento — Postgres real (banco temporário)", () => {
  beforeAll(async () => {
    const [{ atual }] = await query<{ atual: string }>(`select current_database() as atual`);
    if (atual !== banco!.nome) throw new Error(`Fora do banco temporário (${atual}) — abortado antes de gravar.`);
    process.env.INTEGRACAO_SECRET = SEGREDO_INTEGRACAO;
    process.env.CRON_SECRET = SEGREDO_CRON;
    p.admin = await pessoa("admin", "Ana Admin");
    p.vera = await pessoa("vendas", "Vera Vendas");
    p.beto = await pessoa("vendas", "Beto Vendas");
    p.contratos = await pessoa("contratos", "Carla Contratos");
    p.contratos2 = await pessoa("contratos", "Caio Contratos");
    p.implantacao = await pessoa("implantacao", "Ivo Implantação");
    p.financeiro = await pessoa("financeiro", "Fábio Financeiro");
    p.rh = await pessoa("rh", "Rita RH");
    for (const [codigo, nome, pop] of [["4115200", "Maringá", 432635], ["4113700", "Londrina", 584465], ["4104808", "Cascavel", 372026], ["4119905", "Ponta Grossa", 378527], ["4127700", "Toledo", 162658]] as const) {
      await query(`insert into municipio_base (codigo_ibge, nome, nome_busca, uf, populacao, populacao_ano) values ($1, $2, $3, 'PR', $4, 2026)`, [codigo, nome, nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""), pop]);
    }
    await query(`insert into estado_comercial (uf, liberado, liberado_em, liberado_por) values ('PR', true, now(), $1)`, [p.admin.id]);
    // Londrina: cliente ATIVO (vigente). Cascavel: EX-cliente (encerrado) autorizado no mapa.
    [{ id: clientes.londrina }] = await query<{ id: string }>(`insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, codigo_ibge, plano) values ('Prefeitura Municipal de Londrina', 'PR', 1000, '2025-01-01', '4113700', 'grande_porte') returning id`);
    [{ id: clientes.cascavel }] = await query<{ id: string }>(
      `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, codigo_ibge, plano, status_contrato, cancelamento_pedido_em, cancelamento_termino_em,
         latitude, longitude, autorizacao_divulgacao, autorizacao_divulgacao_em, autorizacao_divulgacao_por)
       values ('Prefeitura Municipal de Cascavel', 'PR', 2000, '2024-01-01', '4104808', 'grande_porte', 'encerrado', '2026-01-01', '2026-01-31', -24.95, -53.45, true, now(), $1) returning id`,
      [p.admin.id]
    );
    leads.maringa = await inserirLead("Maringá", "4115200", "PR", p.vera.id, { contato_nome: "Contato do Lead", contato_email: "lead@prefeitura.invalid", plano_interesse: "grande_porte" });
    leads.londrina = await inserirLead("Londrina", "4113700", "PR", p.vera.id);
    leads.cascavel = await inserirLead("Cascavel", "4104808", "PR", p.vera.id);
    leads.pontaGrossa = await inserirLead("Ponta Grossa", "4119905", "PR", p.beto.id);
    leads.semCodigo = await inserirLead("Cidade Sem Código", null, "SC", p.vera.id);
    leads.toledo = await inserirLead("Toledo", "4127700", "PR", p.vera.id);
  }, TEMPO);

  afterAll(() => encerrarBancoTemporario(banco), TEMPO);

  it("migration 0017 aplicada 2× (idempotente): CNPJ antigo vira 14 dígitos; o que não serve vai pro cnpj_legado — nada apagado", async () => {
    await query(`alter table cliente_prefeitura drop constraint ck_cliente_prefeitura_cnpj`);
    const [{ id: formatado }] = await query<{ id: string }>(`insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, cnpj) values ('Prefeitura A', 'SC', 1, '2025-01-01', '11.222.333/0001-81') returning id`);
    const [{ id: lixo }] = await query<{ id: string }>(`insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, cnpj) values ('Prefeitura B', 'SC', 1, '2025-01-01', 'não sei') returning id`);
    const sql = readFileSync("db/migrations/0017_fechamento.sql", "utf-8");
    await query(sql);
    await query(sql);
    expect(await query(`select cnpj, cnpj_legado from cliente_prefeitura where id = any($1::uuid[]) order by nome`, [[formatado, lixo]])).toEqual([
      { cnpj: "11222333000181", cnpj_legado: null },
      { cnpj: null, cnpj_legado: "não sei" }
    ]);
    expect((await query(`select 1 from contrato_modelo where versao = 1`)).length).toBe(4);
    await expect(query(`update cliente_prefeitura set cnpj = '123' where id = $1`, [formatado])).rejects.toMatchObject({ code: "23514", constraint: "ck_cliente_prefeitura_cnpj" });
    await expect(query(`insert into cliente_prefeitura (nome, uf, valor_mensal, status_contrato) values ('Sem início', 'SC', 1, 'ativo')`)).rejects.toMatchObject({ constraint: "ck_cliente_prefeitura_inicio_so_depois_da_assinatura" });
    await expect(query(`insert into cliente_prefeitura (nome, uf, valor_mensal, status_contrato, data_inicio_contrato) values ('Com início', 'SC', 1, 'aguardando_assinatura', '2026-01-01')`)).rejects.toMatchObject({ constraint: "ck_cliente_prefeitura_inicio_so_depois_da_assinatura" });
    await query(`delete from cliente_prefeitura where id = any($1::uuid[])`, [[formatado, lixo]]);
  }, TEMPO);

  it("modelos: versões IMUTÁVEIS (UPDATE/DELETE bloqueados); nova versão valida campos; aprovar registra quem/quando; só admin", async () => {
    const [{ id: v1 }] = await query<{ id: string }>(`select id from contrato_modelo where plano = 'medio_porte' and versao = 1`);
    await expect(query(`update contrato_modelo set conteudo = 'x' where id = $1`, [v1])).rejects.toMatchObject({ code: "P0001" });
    await expect(query(`delete from contrato_modelo where id = $1`, [v1])).rejects.toMatchObject({ code: "P0001" });
    const invalido = await rotaModelos.POST(pedir("/api/modelos-contrato", p.admin.cookie, "POST", { plano: "medio_porte", titulo: "Novo", conteudo: "Olá {{cpf_do_prefeito}}" }));
    expect(invalido.status).toBe(400);
    expect((await invalido.json()).detalhes.fieldErrors.conteudo[0]).toMatch(/\{\{cpf_do_prefeito\}\}/);
    const nova = await rotaModelos.POST(pedir("/api/modelos-contrato", p.admin.cookie, "POST", { plano: "medio_porte", titulo: "Contrato Médio v2", conteudo: "# Contrato\n\n{{municipio_nome}} — {{valor_mensal}}" }));
    expect(nova.status).toBe(201);
    const { id: v2, versao } = await nova.json();
    expect(versao).toBe(2);
    expect((await query(`select conteudo from contrato_modelo where id = $1`, [v1]))[0].conteudo).toContain("MODELO PROVISÓRIO"); // a v1 não mudou
    expect((await rotaAprovar.POST(pedir(`/api/modelos-contrato/${v2}/aprovar`, p.admin.cookie, "POST", {}), ctx(v2))).status).toBe(200);
    expect((await rotaAprovar.POST(pedir(`/api/modelos-contrato/${v2}/aprovar`, p.admin.cookie, "POST", {}), ctx(v2))).status).toBe(409);
    expect(await query(`select status, aprovado_por from contrato_modelo where id = $1`, [v2])).toEqual([{ status: "aprovado", aprovado_por: p.admin.id }]);
    await expect(query(`update contrato_modelo set status = 'rascunho', aprovado_em = null, aprovado_por = null where id = $1`, [v2])).rejects.toMatchObject({ code: "P0001" });
    for (const q of [p.vera, p.contratos, p.implantacao, p.financeiro]) expect((await rotaModelos.GET(pedir("/api/modelos-contrato", q.cookie))).status).toBe(403);
  }, TEMPO);

  it("aceite RECUSADO: lead sem município da base, lead de colega (404), cliente VIGENTE do município, versão velha; a API de etapa continua recusando 'ganho'", async () => {
    const semCodigo = await aceitar(p.vera.cookie, leads.semCodigo, corpoAceite(1));
    expect([semCodigo.status, (await semCodigo.json()).erro]).toEqual([409, "Este lead não está vinculado a um município da base (código IBGE). Vincule o município no detalhe do lead antes de registrar o aceite."]);
    expect((await aceitar(p.vera.cookie, leads.pontaGrossa, corpoAceite(1))).status).toBe(404);
    const vigente = await aceitar(p.vera.cookie, leads.londrina, corpoAceite(1));
    expect([vigente.status, (await vigente.json()).erro]).toEqual([409, "Esta prefeitura já é cliente da NEXAIGEN (contrato ativo) — o aceite não cria outro cliente."]);
    expect((await aceitar(p.vera.cookie, leads.maringa, corpoAceite(99))).status).toBe(409);
    const ganho = await rotaEtapa.POST(pedir(`/api/leads/${leads.maringa}/etapa`, p.vera.cookie, "POST", { acao: "mover", etapa: "ganho" }), ctx(leads.maringa));
    expect([ganho.status, (await ganho.json()).erro]).toEqual([409, 'O lead só vira "Ganho" pelo registro do aceite da prefeitura (botão "Registrar aceite da prefeitura" no detalhe do lead) — a etapa não pode ser marcada por aqui.']);
    expect((await query(`select 1 from cliente_prefeitura where lead_id is not null`)).length).toBe(0);
  }, TEMPO);

  it("aceite é ATÔMICO: falha no meio (trigger na criação da tarefa) → nenhum cliente, evento, histórico ou mudança no lead", async () => {
    await query(`create function falha_no_aceite() returns trigger language plpgsql as $$ begin raise exception 'falha simulada no meio do aceite'; end $$`);
    await query(`create trigger falha_no_aceite before insert on tarefa_operacional for each row execute function falha_no_aceite()`);
    try {
      await expect(aceitar(p.vera.cookie, leads.toledo, corpoAceite(await versaoDoLead(leads.toledo)))).rejects.toThrow(/falha simulada/);
    } finally {
      await query(`drop trigger falha_no_aceite on tarefa_operacional`);
      await query(`drop function falha_no_aceite()`);
    }
    expect(await query(`select etapa, versao from lead where id = $1`, [leads.toledo])).toEqual([{ etapa: "proposta", versao: 1 }]);
    expect((await query(`select 1 from cliente_prefeitura where codigo_ibge = '4127700'`)).length).toBe(0);
    expect((await query(`select 1 from lead_interacao where lead_id = $1`, [leads.toledo])).length).toBe(0);
    expect((await query(`select 1 from cliente_evento_contrato where tipo = 'aceite_registrado'`)).length).toBe(0);
  }, TEMPO);

  it("aceite: cliente AGUARDANDO ASSINATURA (sem início, sem cobrança), lead Ganho + histórico, evento, tarefa de Contratos com prazo; repetido → 409", async () => {
    const r = await aceitar(p.vera.cookie, leads.maringa, corpoAceite(await versaoDoLead(leads.maringa)));
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(Object.keys(corpo).sort()).toEqual(["cliente_id", "reaproveitou_ex_cliente", "tarefa_id"]);
    clientes.maringa = corpo.cliente_id;
    expect(await query(`select nome, status_contrato, data_inicio_contrato, cnpj, endereco_cep, plano, valor_mensal, taxa_implantacao, lead_id, fechado_por from cliente_prefeitura where id = $1`, [clientes.maringa])).toEqual([
      { nome: "Prefeitura Municipal de Maringá", status_contrato: "aguardando_assinatura", data_inicio_contrato: null, cnpj: "11222333000181", endereco_cep: "87013230", plano: "grande_porte", valor_mensal: "35000.00", taxa_implantacao: "30000.00", lead_id: leads.maringa, fechado_por: p.vera.id }
    ]);
    expect(await query(`select etapa, valor_mensal_estimado_centavos from lead where id = $1`, [leads.maringa])).toEqual([{ etapa: "ganho", valor_mensal_estimado_centavos: 3500000 }]);
    expect(await query(`select tipo, etapa_anterior, etapa_nova from lead_interacao where lead_id = $1`, [leads.maringa])).toEqual([{ tipo: "mudanca_etapa", etapa_anterior: "proposta", etapa_nova: "ganho" }]);
    expect(await query(`select tipo, data_evento from cliente_evento_contrato where cliente_id = $1`, [clientes.maringa])).toEqual([{ tipo: "aceite_registrado", data_evento: HOJE }]);
    expect(await query(`select tipo, papel_responsavel, status, prazo from tarefa_operacional where cliente_id = $1`, [clientes.maringa])).toEqual([
      { tipo: "contrato_assinatura", papel_responsavel: "contratos", status: "aberta", prazo: somarDias(HOJE, 5) }
    ]);
    const repetido = await aceitar(p.vera.cookie, leads.maringa, corpoAceite(await versaoDoLead(leads.maringa)));
    expect([repetido.status, (await repetido.json()).erro]).toEqual([409, "O aceite deste lead já foi registrado — o cliente Prefeitura Municipal de Maringá já existe (aguardando assinatura)."]);
  }, TEMPO);

  it("EX-CLIENTE: o aceite reaproveita a MESMA linha (código IBGE é único), volta pra aguardando assinatura e revoga a autorização antiga do mapa", async () => {
    const r = await aceitar(p.vera.cookie, leads.cascavel, corpoAceite(await versaoDoLead(leads.cascavel), { plano: "medio_porte", valor_mensal: "15000", taxa_implantacao: null }));
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect([corpo.cliente_id, corpo.reaproveitou_ex_cliente]).toEqual([clientes.cascavel, true]);
    expect(await query(`select status_contrato, data_inicio_contrato, cancelamento_termino_em, autorizacao_divulgacao, lead_id from cliente_prefeitura where id = $1`, [clientes.cascavel])).toEqual([
      { status_contrato: "aguardando_assinatura", data_inicio_contrato: null, cancelamento_termino_em: null, autorizacao_divulgacao: false, lead_id: leads.cascavel }
    ]);
    expect((await query(`select tipo from cliente_evento_contrato where cliente_id = $1 order by criado_em`, [clientes.cascavel])).map((e) => e.tipo)).toEqual(["divulgacao_revogada", "aceite_registrado"]);
  }, TEMPO);

  it("'aguardando_assinatura' FORA de MRR, Painel, Dashboard, Novos contratos, cron, notas, mapa público e divulgação; Território 'em fechamento'; CRM não abre lead novo", async () => {
    const painel = await obterPainelFinanceiro();
    expect(painel.kpis.mrr).toEqual({ valorCentavos: 100000, contratos: { ativos: 1, emAvisoPrevio: 0, suspensos: 0, encerrados: 0 } }); // só Londrina (R$ 1.000)
    expect(painel.clientes.map((c) => c.id)).toEqual([clientes.londrina]);
    const dashboard = await obterResumoDashboard();
    expect(dashboard.implantacaoACobrar).toEqual({ clientes: 0, centavos: 0 }); // a taxa de Maringá NÃO está "a cobrar"
    expect((await obterRelatorioContratos(HOJE.slice(0, 7))).contratos.map((c) => c.id)).not.toContain(clientes.maringa);

    const cron = await rotaCron.POST(new NextRequest("http://localhost:3001/api/cron/verificar-prazos", { method: "POST", headers: { authorization: `Bearer ${SEGREDO_CRON}` } }));
    expect(cron.status).toBe(200);
    expect(await estado(clientes.maringa)).toMatchObject({ status_contrato: "aguardando_assinatura", data_inicio_contrato: null });

    const nota = await rotaNotas.POST(pedir("/api/notas", p.admin.cookie, "POST", { cliente_id: clientes.maringa, competencia: HOJE.slice(0, 7), valor: "35000,00" }));
    expect(nota.status).toBe(409);
    expect((await nota.json()).erro).toMatch(/aguardando assinatura/);

    await query(`update cliente_prefeitura set latitude = -23.42, longitude = -51.93 where id = $1`, [clientes.maringa]);
    expect(await autorizarDivulgacao(clientes.maringa, p.admin.id, HOJE)).toMatchObject({ ok: false, erro: expect.stringMatching(/aguarda a assinatura/) });
    // Mesmo com a autorização forçada direto no banco, o mapa não mostra pré-contrato.
    await query(`update cliente_prefeitura set autorizacao_divulgacao = true, autorizacao_divulgacao_em = now(), autorizacao_divulgacao_por = $2 where id = $1`, [clientes.maringa, p.admin.id]);
    expect((await obterMapaPublico()).municipios.map((m) => m.nome)).not.toContain("Prefeitura Municipal de Maringá");
    await query(`update cliente_prefeitura set autorizacao_divulgacao = false, autorizacao_divulgacao_em = null, autorizacao_divulgacao_por = null where id = $1`, [clientes.maringa]);

    const [linha] = await carregarLinhas({ codigos: ["4115200"] }, { equipeId: p.admin.id, admin: true }, HOJE);
    expect(linha).toMatchObject({ status: "em_fechamento", contrato: { situacao: "aguardando_assinatura", plano: "grande_porte", desde: null } });
    expect(motivoParaPular(linha, "selecao")).toBe("em fechamento (aceite registrado, aguardando assinatura do contrato)");
    // Cancelamento (equipe e Educa): pré-contrato não tem vigência — nem aviso prévio, nem encerramento imediato (409, nunca 500).
    const registrar = await rotaCancelamento.POST(pedir(`/api/clientes/${clientes.maringa}/cancelamento`, p.admin.cookie, "POST", { dataPedido: HOJE, motivo: "Teste" }), ctx(clientes.maringa));
    expect([registrar.status, (await registrar.json()).erro]).toEqual([409, "Só é possível registrar cancelamento de contrato ativo (este está aguardando assinatura)."]);
    const municipioEduca = randomUUID();
    await query(`update cliente_prefeitura set municipio_id_externo = $1 where id = $2`, [municipioEduca, clientes.cascavel]);
    const encerrar = await rotaCancelamentoEduca.POST(
      new NextRequest(`http://localhost:3001/api/integracao/clientes/${municipioEduca}/cancelamento`, {
        method: "POST",
        headers: { authorization: `Bearer ${SEGREDO_INTEGRACAO}`, "content-type": "application/json", "x-forwarded-for": "10.8.8.8" },
        body: JSON.stringify({ acao: "encerrar", imediato: true })
      }),
      { params: Promise.resolve({ municipioIdExterno: municipioEduca }) }
    );
    expect([encerrar.status, (await encerrar.json()).erro]).toEqual([409, "Este cliente ainda aguarda a assinatura do contrato — não há contrato vigente para encerrar."]);
    expect(await estado(clientes.cascavel)).toMatchObject({ status_contrato: "aguardando_assinatura", data_inicio_contrato: null });
    await query(`update cliente_prefeitura set municipio_id_externo = null where id = $1`, [clientes.cascavel]);

    const novoLead = await rotaLeads.POST(pedir("/api/leads", p.beto.cookie, "POST", { municipio_nome: "Maringá", uf: "PR", codigo_ibge: "4115200", origem: "site" }));
    expect([novoLead.status, (await novoLead.json()).erro]).toEqual([409, "Esta prefeitura já é cliente da NEXAIGEN (contrato aguardando assinatura) — não é lead. Só ex-cliente com contrato encerrado pode virar lead."]);
  }, TEMPO);

  it("contrato GERADO: dono do lead e Contratos baixam (.docx com a faixa de RASCUNHO); vendas de outro lead → 404; implantação/financeiro → 403; dado faltando → 422", async () => {
    const r = await gerar(p.vera.cookie, clientes.maringa);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="contrato-maringa-pr-RASCUNHO.docx"');
    const partes = lerZip(Buffer.from(await r.arrayBuffer()));
    expect(partes["word/header1.xml"]).toContain("RASCUNHO — SEM VALIDADE JURÍDICA — modelo v1 do plano Grande Porte");
    expect(partes["word/document.xml"]).toContain("11.222.333/0001-81");
    expect(partes["word/document.xml"]).toContain("trinta e cinco mil reais");
    expect(partes["word/document.xml"]).toContain("____ de ________ de ____");
    expect((await gerar(p.contratos.cookie, clientes.maringa)).status).toBe(200);
    expect((await gerar(p.beto.cookie, clientes.maringa)).status).toBe(404);
    expect((await gerar(p.implantacao.cookie, clientes.maringa)).status).toBe(403);
    expect((await gerar(p.financeiro.cookie, clientes.maringa)).status).toBe(403);
    const eventos = await query<{ modelo_contrato_id: string | null }>(`select modelo_contrato_id from cliente_evento_contrato where cliente_id = $1 and tipo = 'contrato_gerado'`, [clientes.maringa]);
    expect(eventos).toHaveLength(2);
    expect(eventos.every((e) => e.modelo_contrato_id !== null)).toBe(true);
    const faltando = await gerar(p.contratos.cookie, clientes.londrina); // cliente antigo: sem CNPJ, endereço, representante
    expect(faltando.status).toBe(422);
    expect((await faltando.json()).faltando).toContain("CNPJ da prefeitura, formatado (12.345.678/0001-95)");
  }, TEMPO);

  it("tarefas: cada papel vê SÓ as suas, com as chaves EXATAS do cliente; outro papel → 404; sem área → 403; ações e histórico IMUTÁVEL", async () => {
    const fila = await (await tarefas(p.contratos.cookie)).json();
    const t = fila.tarefas.find((x: { cliente: { id: string } }) => x.cliente.id === clientes.maringa);
    expect(Object.keys(t).sort()).toEqual(["cliente", "criado_em", "historico", "id", "minha", "observacao", "prazo", "responsavel_nome", "selo", "status", "tipo"]);
    expect(Object.keys(t.cliente).sort()).toEqual([
      "cnpj", "contato_cargo", "contato_email", "contato_nome", "contato_telefone", "endereco_bairro", "endereco_cep", "endereco_complemento",
      "endereco_logradouro", "endereco_numero", "id", "nome", "plano", "representante_cargo", "representante_nome", "status_contrato", "taxa_implantacao_centavos", "valor_mensal_centavos"
    ]);
    expect(t.cliente).toMatchObject({ valor_mensal_centavos: 3500000, taxa_implantacao_centavos: 3000000 });
    expect((await (await tarefas(p.implantacao.cookie)).json()).tarefas).toEqual([]); // nenhuma tarefa de contrato pra Implantação
    expect((await agir(p.implantacao.cookie, t.id, { acao: "assumir" })).status).toBe(404);
    for (const q of [p.vera, p.financeiro, p.rh]) expect((await tarefas(q.cookie)).status).toBe(403);
    expect((await tarefas(p.contratos.cookie, "todas")).status).toBe(403);

    expect(await (await agir(p.contratos.cookie, t.id, { acao: "assumir" })).json()).toEqual({ status: "em_andamento" });
    const outro = await agir(p.contratos2.cookie, t.id, { acao: "assumir" });
    expect([outro.status, (await outro.json()).erro]).toEqual([409, "Esta tarefa já foi assumida por Carla Contratos."]);
    expect((await agir(p.contratos.cookie, t.id, { acao: "concluir" })).status).toBe(409); // conclui sozinha na assinatura
    expect((await agir(p.contratos.cookie, t.id, { acao: "prazo", prazo: somarDias(HOJE, 10) })).status).toBe(403);
    expect((await agir(p.admin.cookie, t.id, { acao: "prazo", prazo: somarDias(HOJE, 10) })).status).toBe(200);
    const minhas = await (await tarefas(p.contratos.cookie, "minhas")).json();
    expect(minhas.tarefas.map((x: { id: string }) => x.id)).toEqual([t.id]);
    expect(minhas.tarefas[0].historico.map((h: { acao: string }) => h.acao)).toEqual(["criada", "assumida", "prazo_alterado"]);
    await expect(query(`update tarefa_historico set detalhe = 'x' where tarefa_id = $1`, [t.id])).rejects.toMatchObject({ code: "P0001" });
    await expect(query(`delete from tarefa_historico where tarefa_id = $1`, [t.id])).rejects.toMatchObject({ code: "P0001" });
  }, TEMPO);

  it("assinatura: Implantação → 404; data futura, PDF inválido e bucket fora do ar NÃO mudam nada; válida → ATIVO com início = assinatura, tarefa concluída e implantação aberta", async () => {
    const ontem = somarDias(HOJE, -1);
    expect((await assinar(p.implantacao.cookie, clientes.maringa, ontem)).status).toBe(404);
    expect((await assinar(p.contratos.cookie, clientes.maringa, somarDias(HOJE, 1))).status).toBe(400);
    expect((await assinar(p.contratos.cookie, clientes.maringa, ontem, Buffer.from("não é pdf"))).status).toBe(400);
    bucketEmMemoria.falhas.proximoUpload = true;
    const bucket = await assinar(p.contratos.cookie, clientes.maringa, ontem);
    expect([bucket.status, (await bucket.json()).erro]).toEqual([502, "Armazenamento indisponível no momento — tente novamente em instantes."]);
    expect(await estado(clientes.maringa)).toEqual({ status_contrato: "aguardando_assinatura", data_inicio_contrato: null, versoes: 0 });

    const ok = await assinar(p.contratos.cookie, clientes.maringa, ontem);
    expect(ok.status).toBe(200);
    const corpo = await ok.json();
    expect(Object.keys(corpo).sort()).toEqual(["tarefa_implantacao_id", "versao_contrato"]);
    expect(await estado(clientes.maringa)).toEqual({ status_contrato: "ativo", data_inicio_contrato: ontem, versoes: 1 });
    expect((await query(`select tipo from cliente_evento_contrato where cliente_id = $1 and tipo = 'assinatura_registrada'`, [clientes.maringa])).length).toBe(1);
    expect(await query(`select tipo, status, prazo from tarefa_operacional where cliente_id = $1 order by criado_em`, [clientes.maringa])).toEqual([
      { tipo: "contrato_assinatura", status: "concluida", prazo: somarDias(HOJE, 10) },
      { tipo: "implantacao", status: "aberta", prazo: somarDias(HOJE, 15) }
    ]);
    expect((await assinar(p.contratos.cookie, clientes.maringa, ontem)).status).toBe(409);
    // Agora SIM entra no MRR (a exclusão era por estar aguardando assinatura).
    expect((await obterPainelFinanceiro()).kpis.mrr.valorCentavos).toBe(100000 + 3500000);
    // Implantação: dados MÍNIMOS (chaves exatas), nada financeiro; Contratos não enxerga a tarefa dela.
    const impl = (await (await tarefas(p.implantacao.cookie)).json()).tarefas[0];
    expect(Object.keys(impl.cliente).sort()).toEqual(["codigo_ibge", "contato_cargo", "contato_email", "contato_nome", "contato_telefone", "id", "nome", "plano", "uf"]);
    expect((await agir(p.contratos.cookie, impl.id, { acao: "assumir" })).status).toBe(404);
  }, TEMPO);

  it("contrato depois de aprovado o modelo: sem faixa de rascunho e com a data da assinatura por extenso", async () => {
    const [{ id }] = await query<{ id: string }>(`select id from contrato_modelo where plano = 'grande_porte' and versao = 1`);
    expect((await rotaAprovar.POST(pedir(`/api/modelos-contrato/${id}/aprovar`, p.admin.cookie, "POST", {}), ctx(id))).status).toBe(200);
    const r = await gerar(p.contratos.cookie, clientes.maringa);
    const partes = lerZip(Buffer.from(await r.arrayBuffer()));
    expect(partes["word/header1.xml"]).toBeUndefined();
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="contrato-maringa-pr.docx"');
    expect(partes["word/document.xml"]).not.toContain("____ de ________ de ____");
  }, TEMPO);

  it("endpoint do Educa: chaves EXATAS (nada financeiro); 409 aguardando; 404; 400 chave inválida; 401 sem segredo; rate limit", async () => {
    const get = (chave: string, auth = `Bearer ${SEGREDO_INTEGRACAO}`, ip = "10.9.9.1") =>
      rotaImplantacao.GET(new NextRequest(`http://localhost:3001/api/integracao/implantacoes/${chave}`, { headers: { authorization: auth, "x-forwarded-for": ip } }), { params: Promise.resolve({ chave }) });
    const ok = await get("4115200");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const dados = await ok.json();
    expect(Object.keys(dados).sort()).toEqual(["codigo_ibge", "contato", "data_assinatura", "nome", "plano", "status", "uf"]);
    expect(Object.keys(dados.contato).sort()).toEqual(["cargo", "email", "nome", "telefone"]);
    expect(dados).toMatchObject({ codigo_ibge: "4115200", plano: "grande_porte", status: "ativo", data_assinatura: somarDias(HOJE, -1) });
    expect(JSON.stringify(dados)).not.toMatch(/35000|11222333000181|Av\. XV|Prefeito de Teste/);
    expect((await get("4104808")).status).toBe(409); // Cascavel aguardando assinatura
    expect((await get("4199999")).status).toBe(404);
    expect((await get("xyz")).status).toBe(400);
    expect((await get("4115200", "Bearer errado", "10.9.9.2")).status).toBe(401);
    let ultimo = 0;
    for (let i = 0; i < 11; i++) ultimo = (await get("4115200", "Bearer errado", "10.9.9.3")).status;
    expect(ultimo).toBe(429);
  }, TEMPO);

  it("POST do Educa com codigoIbge: ATUALIZA o cliente do fechamento (não duplica), mantém plano/valor/início e conclui a implantação (autor: integração Educa)", async () => {
    const municipioIdExterno = randomUUID();
    const r = await rotaIntegracao.POST(
      new NextRequest("http://localhost:3001/api/integracao/clientes", {
        method: "POST",
        headers: { authorization: `Bearer ${SEGREDO_INTEGRACAO}`, "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
        body: JSON.stringify({ municipioIdExterno, codigoIbge: "4115200", nome: "Prefeitura Municipal de Maringá", uf: "PR", valorMensal: 1, dataInicioContrato: "2020-01-01", plano: "dispensa" })
      })
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: clientes.maringa, criado: false, implantacaoConcluida: true });
    expect(await query(`select municipio_id_externo, plano, valor_mensal, data_inicio_contrato from cliente_prefeitura where id = $1`, [clientes.maringa])).toEqual([
      { municipio_id_externo: municipioIdExterno, plano: "grande_porte", valor_mensal: "35000.00", data_inicio_contrato: somarDias(HOJE, -1) }
    ]);
    expect((await query(`select 1 from cliente_prefeitura where codigo_ibge = '4115200'`)).length).toBe(1);
    expect(await query(`select h.autor_id, h.detalhe from tarefa_historico h join tarefa_operacional t on t.id = h.tarefa_id where t.cliente_id = $1 and t.tipo = 'implantacao' and h.acao = 'concluida'`, [clientes.maringa])).toEqual([
      { autor_id: null, detalhe: "Concluída automaticamente: integração Educa (município provisionado)." }
    ]);
    const historico = (await (await tarefas(p.admin.cookie, "todas")).json()).tarefas.find((t: { tipo: string; cliente: { id: string } }) => t.tipo === "implantacao" && t.cliente.id === clientes.maringa).historico;
    expect(historico.at(-1)).toMatchObject({ acao: "concluida", autor_nome: "integração Educa" });
    expect((await rotaImplantacao.GET(new NextRequest(`http://localhost:3001/api/integracao/implantacoes/${municipioIdExterno}`, { headers: { authorization: `Bearer ${SEGREDO_INTEGRACAO}`, "x-forwarded-for": "10.9.9.9" } }), { params: Promise.resolve({ chave: municipioIdExterno }) })).status).toBe(200);
  }, TEMPO);
});
