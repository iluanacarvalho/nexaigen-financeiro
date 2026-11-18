// CRM (rodada 16-A) contra Postgres REAL, pelas ROTAS reais com sessão de
// verdade — num BANCO TEMPORÁRIO (testes/bancoTemporario.ts): o histórico
// do CRM é somente-acréscimo (não dá pra apagar depois), então nada disto
// pode ir pro banco local de desenvolvimento. O arquivo troca o
// DATABASE_URL ANTES de importar qualquer módulo que abre o pool
// (lib/db.ts) e confere com current_database() — se não estiver no banco
// temporário, para antes de gravar qualquer coisa. Só roda com DATABASE_URL local.
//
// Cobre: papéis (financeiro/rh 403 em tudo), ISOLAMENTO do vendedor (404 em
// leitura e escrita de lead de colega — com prova de mutação), consulta
// mínima com chaves EXATAS (com prova de mutação), duplicidade (lead aberto
// e cliente), 'ganho' recusado, perda sem motivo, reabertura, histórico
// imutável, etapa + histórico atômicos (falha simulada no meio), controle
// otimista, pedido de reatribuição (60 dias com data fixa, não muda o dono
// até aprovar, sem pedido duplicado), CHECKs, "parado" SQL = regra pura nas
// bordas, sugestão de preço, exportação só admin.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { bancoLocal, criarBancoTemporario, type BancoTemporario } from "@/testes/bancoTemporario";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const LOCAL = bancoLocal();
let banco: BancoTemporario | null = null;
if (LOCAL) {
  banco = await criarBancoTemporario("crm");
  process.env.DATABASE_URL = banco.url; // ANTES de qualquer import de lib/db
}

// Imports dinâmicos DEPOIS de trocar o DATABASE_URL (o pool de lib/db nasce na importação).
const { query } = await import("./db");
const { gerarAccessToken, NOME_COOKIE_ACCESS } = await import("./auth");
const { lerZip } = await import("@/testes/lerZip");
const servico = await import("./crmServico");
const repo = await import("./crmRepositorio");
const rotaLeads = await import("@/app/api/leads/route");
const rotaLead = await import("@/app/api/leads/[id]/route");
const rotaInteracoes = await import("@/app/api/leads/[id]/interacoes/route");
const rotaEtapa = await import("@/app/api/leads/[id]/etapa/route");
const rotaVendedor = await import("@/app/api/leads/[id]/vendedor/route");
const rotaPedido = await import("@/app/api/leads/[id]/pedidos/route");
const rotaConsulta = await import("@/app/api/leads/consulta/route");
const rotaResumo = await import("@/app/api/leads/resumo/route");
const rotaExportar = await import("@/app/api/leads/exportar/route");
const rotaPedidos = await import("@/app/api/leads/pedidos/route");
const rotaDecisao = await import("@/app/api/leads/pedidos/[id]/route");

type Pessoa = { id: string; nome: string; cookie: string };
const pessoas: Record<string, Pessoa> = {};

async function conta(chave: string, papel: string, nome: string): Promise<Pessoa> {
  const [e] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria, papel) values ($1, $2, 'x', false, $3) returning id, token_version`,
    [nome, `${chave}-${randomUUID().slice(0, 6)}@teste.invalid`, papel]
  );
  const p = { id: e.id, nome, cookie: `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId: e.id, nome, precisaTrocarSenha: false, tokenVersion: e.token_version })}` };
  pessoas[chave] = p;
  return p;
}

const req = (url: string, quem: Pessoa, metodo = "GET", corpo?: unknown) =>
  new NextRequest(`http://localhost:3001${url}`, { method: metodo, headers: { cookie: quem.cookie, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function criar(quem: Pessoa, corpo: Record<string, unknown>) {
  return rotaLeads.POST(req("/api/leads", quem, "POST", { origem: "indicacao", ...corpo }));
}
async function criarId(quem: Pessoa, corpo: Record<string, unknown>): Promise<string> {
  const res = await criar(quem, corpo);
  expect(res.status).toBe(201);
  return (await res.json()).id;
}
const versaoDe = async (id: string) => (await query<{ versao: number }>(`select versao from lead where id = $1`, [id]))[0].versao;

describe.skipIf(!LOCAL)("CRM — Postgres real (banco temporário)", () => {
  beforeAll(async () => {
    const [{ banco: atual }] = await query<{ banco: string }>(`select current_database() as banco`);
    if (atual !== banco!.nome) throw new Error(`Teste do CRM fora do banco temporário (${atual}) — abortado antes de gravar.`);
    await conta("admin", "admin", "Ana Admin");
    await conta("vendasA", "vendas", "Vera Vendas");
    await conta("vendasB", "vendas", "Beto Vendas");
    await conta("financeiro", "financeiro", "Fábio Financeiro");
    await conta("rh", "rh", "Rita RH");
  });

  afterAll(async () => {
    const pool = (globalThis as { __nexaigenFinPgPool?: { end: () => Promise<void> } }).__nexaigenFinPgPool;
    await pool?.end();
    await banco?.derrubar();
  });

  describe("papéis", () => {
    it("financeiro e rh: 403 em TODAS as rotas do CRM (inclusive a consulta)", async () => {
      const id = randomUUID();
      for (const quem of [pessoas.financeiro, pessoas.rh]) {
        const respostas = await Promise.all([
          rotaLeads.GET(req("/api/leads", quem)),
          criar(quem, { municipio_nome: "X", uf: "PR" }),
          rotaLead.GET(req(`/api/leads/${id}`, quem), ctx(id)),
          rotaLead.PATCH(req(`/api/leads/${id}`, quem, "PATCH", { versao: 1, contato_nome: "x" }), ctx(id)),
          rotaInteracoes.POST(req(`/api/leads/${id}/interacoes`, quem, "POST", { tipo: "nota", texto: "x" }), ctx(id)),
          rotaEtapa.POST(req(`/api/leads/${id}/etapa`, quem, "POST", { acao: "reabrir" }), ctx(id)),
          rotaVendedor.POST(req(`/api/leads/${id}/vendedor`, quem, "POST", { vendedor_id: id }), ctx(id)),
          rotaPedido.POST(req(`/api/leads/${id}/pedidos`, quem, "POST"), ctx(id)),
          rotaConsulta.GET(req("/api/leads/consulta?busca=xx", quem)),
          rotaResumo.GET(req("/api/leads/resumo", quem)),
          rotaExportar.GET(req("/api/leads/exportar?formato=csv", quem)),
          rotaPedidos.GET(req("/api/leads/pedidos", quem)),
          rotaDecisao.POST(req(`/api/leads/pedidos/${id}`, quem, "POST", { decisao: "negado" }), ctx(id))
        ]);
        expect(respostas.map((r) => r.status)).toEqual(Array(13).fill(403));
      }
    });
  });

  describe("isolamento do vendedor (filtro no SQL)", () => {
    let deA: string;
    let deB: string;
    beforeAll(async () => {
      deA = await criarId(pessoas.vendasA, { municipio_nome: "Arapongas", uf: "PR", contato_nome: "Secretária A", contato_email: "a@arapongas.pr.gov.br" });
      deB = await criarId(pessoas.vendasB, { municipio_nome: "Jaguapitã", uf: "PR", codigo_ibge: "4112207", contato_nome: "Secretário B", plano_interesse: "pequeno_porte" });
    });

    it("vendas lista e lê SÓ os seus; admin vê todos", async () => {
      const listaA = await (await rotaLeads.GET(req("/api/leads", pessoas.vendasA))).json();
      expect(listaA.leads.map((l: { id: string }) => l.id)).toEqual([deA]);
      const listaAdmin = await (await rotaLeads.GET(req("/api/leads", pessoas.admin))).json();
      expect(listaAdmin.leads.map((l: { id: string }) => l.id).sort()).toEqual([deA, deB].sort());
      expect((await rotaLead.GET(req(`/api/leads/${deB}`, pessoas.admin), ctx(deB))).status).toBe(200);
      expect((await rotaLeads.GET(req(`/api/leads?vendedor_id=${pessoas.vendasB.id}`, pessoas.vendasA))).status).toBe(403);
    });

    it("lead de colega: 404 em LEITURA e em toda ESCRITA (editar, etapa, interação) — e nada muda", async () => {
      const versao = await versaoDe(deB);
      const respostas = await Promise.all([
        rotaLead.GET(req(`/api/leads/${deB}`, pessoas.vendasA), ctx(deB)),
        rotaLead.PATCH(req(`/api/leads/${deB}`, pessoas.vendasA, "PATCH", { versao, contato_nome: "invasor" }), ctx(deB)),
        rotaEtapa.POST(req(`/api/leads/${deB}/etapa`, pessoas.vendasA, "POST", { acao: "mover", etapa: "contato" }), ctx(deB)),
        rotaInteracoes.POST(req(`/api/leads/${deB}/interacoes`, pessoas.vendasA, "POST", { tipo: "nota", texto: "invasão" }), ctx(deB))
      ]);
      expect(respostas.map((r) => r.status)).toEqual([404, 404, 404, 404]);
      for (const r of respostas) expect(await r.json()).toEqual({ erro: "Lead não encontrado." });
      const [lead] = await query<{ contato_nome: string; etapa: string; versao: number }>(`select contato_nome, etapa, versao from lead where id = $1`, [deB]);
      expect(lead).toEqual({ contato_nome: "Secretário B", etapa: "novo", versao });
      expect(await query(`select 1 from lead_interacao where lead_id = $1`, [deB])).toEqual([]);
      // Reatribuir é gestão: vendas recebe 403 (área crm_gestao), mesmo no próprio lead.
      expect((await rotaVendedor.POST(req(`/api/leads/${deA}/vendedor`, pessoas.vendasA, "POST", { vendedor_id: pessoas.vendasB.id }), ctx(deA))).status).toBe(403);
    });

    it("resumo: cada vendedor conta só os seus", async () => {
      const resumoA = await (await rotaResumo.GET(req("/api/leads/resumo", pessoas.vendasA))).json();
      expect(resumoA.abertos.quantidade).toBe(1);
      expect(resumoA.cargaPorVendedor).toBeNull();
      const resumoAdmin = await (await rotaResumo.GET(req("/api/leads/resumo", pessoas.admin))).json();
      expect(resumoAdmin.abertos.quantidade).toBeGreaterThanOrEqual(2);
      expect(resumoAdmin.cargaPorVendedor.map((v: { vendedor_nome: string }) => v.vendedor_nome).sort()).toEqual(expect.arrayContaining(["Beto Vendas", "Vera Vendas"]));
    });

    it("consulta mínima: lead de colega com EXATAMENTE as chaves permitidas; acha sem acento e por código IBGE", async () => {
      const porNome = await (await rotaConsulta.GET(req("/api/leads/consulta?busca=JAGUAPITA", pessoas.vendasA))).json();
      expect(porNome.leads).toHaveLength(1);
      const [r] = porNome.leads;
      expect(Object.keys(r).sort()).toEqual(["etapa", "id", "meu_lead", "municipio_nome", "pode_pedir", "uf", "ultima_atividade_em", "vendedor_nome"]);
      expect(r).toMatchObject({ municipio_nome: "Jaguapitã", uf: "PR", etapa: "novo", vendedor_nome: "Beto Vendas", meu_lead: false, pode_pedir: false });
      expect(r.ultima_atividade_em).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(JSON.stringify(porNome)).not.toMatch(/Secretário B|pequeno_porte|4112207|indicacao|850000/);
      const porCodigo = await (await rotaConsulta.GET(req("/api/leads/consulta?codigo_ibge=4112207", pessoas.vendasA))).json();
      expect(porCodigo.leads.map((l: { id: string }) => l.id)).toEqual([deB]);
      const meu = await (await rotaConsulta.GET(req("/api/leads/consulta?busca=arapongas", pessoas.vendasA))).json();
      expect(meu.leads[0]).toMatchObject({ meu_lead: true, pode_pedir: false });
      expect((await rotaConsulta.GET(req("/api/leads/consulta", pessoas.vendasA))).status).toBe(400);
    });

    it("duplicidade: lead aberto (nome sem acento/caixa ou código) → 409 que revela SÓ vendedor e etapa; dono e admin recebem o id", async () => {
      const deColega = await criar(pessoas.vendasA, { municipio_nome: "Prefeitura Municipal de JAGUAPITA", uf: "PR" });
      expect(deColega.status).toBe(409);
      expect(await deColega.json()).toEqual({ erro: "Já existe esse lead: está com Beto Vendas, etapa Novo.", duplicado: { vendedor_nome: "Beto Vendas", etapa: "novo" } });
      const porCodigo = await criar(pessoas.vendasA, { municipio_nome: "Outro Nome", uf: "PR", codigo_ibge: "4112207" });
      expect(porCodigo.status).toBe(409);
      const doDono = await criar(pessoas.vendasB, { municipio_nome: "jaguapitã", uf: "PR" });
      expect((await doDono.json()).duplicado).toEqual({ vendedor_nome: "Beto Vendas", etapa: "novo", id: deB });
      // Mesmo nome, outra UF: não é duplicado.
      expect((await criar(pessoas.vendasA, { municipio_nome: "Jaguapitã", uf: "SC" })).status).toBe(201);
    });

    it("cliente ATIVO → 409 'já é cliente (contrato ativo)' (código IBGE ou nome+UF)", async () => {
      await query(`insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, codigo_ibge) values ('Prefeitura Municipal de Londrina', 'PR', 1000, '2026-01-01', '4113700')`);
      const porNome = await criar(pessoas.vendasA, { municipio_nome: "LONDRINA", uf: "PR" });
      expect(porNome.status).toBe(409);
      expect((await porNome.json()).erro).toBe("Esta prefeitura já é cliente da NEXAIGEN (contrato ativo) — não é lead. Só ex-cliente com contrato encerrado pode virar lead.");
      expect((await criar(pessoas.vendasA, { municipio_nome: "Outra", uf: "PR", codigo_ibge: "4113700" })).status).toBe(409);
    });

    it("EX-CLIENTE (rodada 16-A1): encerrado → lead permitido com a marca 'ex-cliente' e a data; em aviso prévio (encerrando) e suspenso → bloqueiam", async () => {
      const [{ id: maringa }] = await query<{ id: string }>(
        `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, status_contrato, cancelamento_pedido_em, cancelamento_termino_em)
         values ('Prefeitura de Maringá', 'PR', 1000, '2025-01-01', 'encerrado', '2026-03-01', '2026-03-31') returning id`
      );
      await query(`insert into cliente_evento_contrato (cliente_id, tipo, data_evento, origem) values ($1, 'contrato_encerrado', '2026-03-31', 'sistema')`, [maringa]);
      await query(`insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, status_contrato) values ('Prefeitura de Toledo', 'PR', 1000, '2020-01-01', 'encerrado')`); // legado: sem data
      await query(
        `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, status_contrato, cancelamento_pedido_em, cancelamento_termino_em)
         values ('Prefeitura de Umuarama', 'PR', 1000, '2025-01-01', 'em_aviso_previo', current_date - 5, current_date + 25),
                ('Prefeitura de Cianorte', 'PR', 1000, '2025-01-01', 'em_aviso_previo', current_date - 40, current_date - 10),
                ('Prefeitura de Paranavaí', 'PR', 1000, '2025-01-01', 'suspenso', null, null)`
      );
      const exMaringa = await criarId(pessoas.vendasA, { municipio_nome: "MARINGA", uf: "PR" });
      const exToledo = await criarId(pessoas.vendasA, { municipio_nome: "Toledo", uf: "PR" });
      const exCianorte = await criarId(pessoas.vendasA, { municipio_nome: "Cianorte", uf: "PR" }); // aviso já vencido = encerrado de fato
      const encerrando = await criar(pessoas.vendasA, { municipio_nome: "Umuarama", uf: "PR" });
      expect(encerrando.status).toBe(409);
      expect((await encerrando.json()).erro).toMatch(/já é cliente da NEXAIGEN \(contrato em aviso prévio\)/);
      expect((await criar(pessoas.vendasA, { municipio_nome: "Paranavaí", uf: "PR" })).status).toBe(409);

      const detalhe = await (await rotaLead.GET(req(`/api/leads/${exMaringa}`, pessoas.vendasA), ctx(exMaringa))).json();
      expect(detalhe.lead).toMatchObject({ ex_cliente: true, ex_cliente_encerrado_em: "2026-03-31" });
      const lista = await (await rotaLeads.GET(req("/api/leads?por_pagina=100", pessoas.vendasA))).json();
      const marca = (id: string) => lista.leads.find((l: { id: string }) => l.id === id);
      expect(marca(exToledo)).toMatchObject({ ex_cliente: true, ex_cliente_encerrado_em: null });
      expect(marca(exCianorte).ex_cliente).toBe(true);
      expect(marca(exCianorte).ex_cliente_encerrado_em).toMatch(/^\d{4}-\d{2}-\d{2}$/); // término do aviso
      expect(lista.leads.filter((l: { ex_cliente: boolean }) => !l.ex_cliente).every((l: { municipio_nome: string }) => !["Maringá", "Toledo", "Cianorte"].includes(l.municipio_nome))).toBe(true);
      // A consulta mínima de colega NÃO ganha campo novo (as chaves continuam exatas — teste acima).
    });
  });

  describe("etapas e histórico", () => {
    let id: string;
    beforeAll(async () => {
      id = await criarId(pessoas.vendasA, { municipio_nome: "Cambé", uf: "PR", plano_interesse: "pequeno_porte" });
    });

    it("plano sem valor → sugere a mensalidade padrão do plano (850000 centavos)", async () => {
      const [lead] = await query<{ valor_mensal_estimado_centavos: number }>(`select valor_mensal_estimado_centavos from lead where id = $1`, [id]);
      expect(lead.valor_mensal_estimado_centavos).toBe(850000);
    });

    it("'ganho' → 409 (fechamento é a 16-B); mover pra perdido sem motivo → 409; perder sem motivo (schema) → 400", async () => {
      const ganho = await rotaEtapa.POST(req(`/api/leads/${id}/etapa`, pessoas.vendasA, "POST", { acao: "mover", etapa: "ganho" }), ctx(id));
      expect(ganho.status).toBe(409);
      expect((await ganho.json()).erro).toMatch(/fluxo de fechamento \(rodada 16-B\)/);
      expect((await rotaEtapa.POST(req(`/api/leads/${id}/etapa`, pessoas.vendasA, "POST", { acao: "mover", etapa: "perdido" }), ctx(id))).status).toBe(409);
      expect((await rotaEtapa.POST(req(`/api/leads/${id}/etapa`, pessoas.vendasA, "POST", { acao: "perder" }), ctx(id))).status).toBe(400);
      const [lead] = await query<{ etapa: string }>(`select etapa from lead where id = $1`, [id]);
      expect(lead.etapa).toBe("novo");
    });

    it("avançar, perder com motivo, reabrir → etapas, motivo e histórico corretos", async () => {
      expect((await rotaEtapa.POST(req(`/api/leads/${id}/etapa`, pessoas.vendasA, "POST", { acao: "mover", etapa: "proposta" }), ctx(id))).status).toBe(200);
      expect((await rotaEtapa.POST(req(`/api/leads/${id}/etapa`, pessoas.vendasA, "POST", { acao: "perder", motivo: "concorrente", detalhe: "Fechou com outro" }), ctx(id))).status).toBe(200);
      let [lead] = await query<{ etapa: string; motivo_perda: string | null; detalhe_perda: string | null }>(`select etapa, motivo_perda, detalhe_perda from lead where id = $1`, [id]);
      expect(lead).toEqual({ etapa: "perdido", motivo_perda: "concorrente", detalhe_perda: "Fechou com outro" });
      expect((await rotaEtapa.POST(req(`/api/leads/${id}/etapa`, pessoas.vendasA, "POST", { acao: "mover", etapa: "contato" }), ctx(id))).status).toBe(409);
      expect((await rotaEtapa.POST(req(`/api/leads/${id}/etapa`, pessoas.vendasA, "POST", { acao: "reabrir" }), ctx(id))).status).toBe(200);
      [lead] = await query(`select etapa, motivo_perda, detalhe_perda from lead where id = $1`, [id]);
      expect(lead).toEqual({ etapa: "contato", motivo_perda: null, detalhe_perda: null });
      const historico = await query<{ tipo: string; etapa_anterior: string; etapa_nova: string; texto: string | null }>(
        `select tipo, etapa_anterior, etapa_nova, texto from lead_interacao where lead_id = $1 order by em`,
        [id]
      );
      expect(historico).toEqual([
        { tipo: "mudanca_etapa", etapa_anterior: "novo", etapa_nova: "proposta", texto: null },
        { tipo: "mudanca_etapa", etapa_anterior: "proposta", etapa_nova: "perdido", texto: "Motivo: Concorrente. Fechou com outro" },
        { tipo: "reabertura", etapa_anterior: "perdido", etapa_nova: "contato", texto: null }
      ]);
    });

    it("histórico IMUTÁVEL: UPDATE, DELETE e TRUNCATE bloqueados no banco", async () => {
      await expect(query(`update lead_interacao set texto = 'alterado' where lead_id = $1`, [id])).rejects.toMatchObject({ code: "P0001" });
      await expect(query(`delete from lead_interacao where lead_id = $1`, [id])).rejects.toMatchObject({ code: "P0001" });
      await expect(query(`truncate lead_interacao`)).rejects.toMatchObject({ code: "P0001" });
      expect(await query(`select 1 from lead_interacao where lead_id = $1`, [id])).toHaveLength(3);
    });

    it("etapa + histórico ATÔMICOS: falha simulada ao gravar o histórico desfaz a mudança de etapa", async () => {
      const antes = await query<{ etapa: string; versao: number }>(`select etapa, versao from lead where id = $1`, [id]);
      const historicoAntes = await query(`select 1 from lead_interacao where lead_id = $1`, [id]);
      await query(`create function falha_simulada() returns trigger language plpgsql as $$ begin raise exception 'falha simulada'; end; $$`);
      await query(`create trigger falha_simulada before insert on lead_interacao for each row execute function falha_simulada()`);
      try {
        await expect(rotaEtapa.POST(req(`/api/leads/${id}/etapa`, pessoas.vendasA, "POST", { acao: "mover", etapa: "negociacao" }), ctx(id))).rejects.toThrow(/falha simulada/);
      } finally {
        await query(`drop trigger falha_simulada on lead_interacao`);
        await query(`drop function falha_simulada()`);
      }
      expect(await query(`select etapa, versao from lead where id = $1`, [id])).toEqual(antes); // update da etapa desfeito
      expect(await query(`select 1 from lead_interacao where lead_id = $1`, [id])).toHaveLength(historicoAntes.length);
    });

    it("controle otimista: duas edições com a MESMA versão — uma passa, a outra 409 'recarregue'", async () => {
      const versao = await versaoDe(id);
      const primeira = await rotaLead.PATCH(req(`/api/leads/${id}`, pessoas.vendasA, "PATCH", { versao, contato_nome: "Pessoa 1" }), ctx(id));
      const segunda = await rotaLead.PATCH(req(`/api/leads/${id}`, pessoas.vendasA, "PATCH", { versao, contato_nome: "Pessoa 2" }), ctx(id));
      expect(primeira.status).toBe(200);
      expect(await primeira.json()).toEqual({ versao: versao + 1, alterados: ["contato_nome"] });
      expect(segunda.status).toBe(409);
      expect((await segunda.json()).erro).toMatch(/alterou este lead, recarregue/);
      const [lead] = await query<{ contato_nome: string }>(`select contato_nome from lead where id = $1`, [id]);
      expect(lead.contato_nome).toBe("Pessoa 1");
      const [edicao] = await query<{ texto: string }>(`select texto from lead_interacao where lead_id = $1 and tipo = 'edicao'`, [id]);
      expect(edicao.texto).toBe("Alterou: nome do contato.");
    });
  });

  describe("pedido de reatribuição", () => {
    let parado: string;
    let recente: string;
    beforeAll(async () => {
      parado = await criarId(pessoas.vendasB, { municipio_nome: "Rolândia", uf: "PR" });
      recente = await criarId(pessoas.vendasB, { municipio_nome: "Ibiporã", uf: "PR" });
      // Criado em 18/09/2026 (o histórico não tem nenhuma atividade): a "última atividade" é a criação.
      await query(`update lead set criado_em = '2026-09-18T15:00:00Z' where id = $1`, [parado]);
    });

    it("60 dias com DATA FIXA: em 17/11 (60 dias) ainda não pode; em 18/11 (61 dias) pode", async () => {
      const a = { equipeId: pessoas.vendasA.id, admin: false };
      expect(await servico.pedirLead(parado, a, "2026-11-17")).toMatchObject({ ok: false, motivo: "conflito", erro: expect.stringMatching(/mais de 60 dias/) });
      const consulta60 = await repo.consultarLeads({ busca: "rolandia", pagina: 1, porPagina: 10 }, a, "2026-11-17");
      expect(consulta60.leads[0].pode_pedir).toBe(false);
      const consulta61 = await repo.consultarLeads({ busca: "rolandia", pagina: 1, porPagina: 10 }, a, "2026-11-18");
      expect(consulta61.leads[0].pode_pedir).toBe(true);
      expect(await servico.pedirLead(parado, a, "2026-11-18")).toMatchObject({ ok: true });
    });

    it("não muda o dono; não duplica pedido pendente; lead recente → 409; lead próprio → 409", async () => {
      const a = { equipeId: pessoas.vendasA.id, admin: false };
      const [lead] = await query<{ vendedor_id: string }>(`select vendedor_id from lead where id = $1`, [parado]);
      expect(lead.vendedor_id).toBe(pessoas.vendasB.id);
      expect(await servico.pedirLead(parado, a, "2026-11-18")).toEqual({ ok: false, motivo: "conflito", erro: "Você já tem um pedido pendente para este lead." });
      expect((await rotaPedido.POST(req(`/api/leads/${recente}/pedidos`, pessoas.vendasA, "POST"), ctx(recente))).status).toBe(409);
      expect((await rotaPedido.POST(req(`/api/leads/${recente}/pedidos`, pessoas.vendasB, "POST"), ctx(recente))).status).toBe(409);
      expect(await query(`select 1 from lead_pedido_reatribuicao where resolvido_em is null and lead_id = $1`, [parado])).toHaveLength(1);
    });

    it("admin vê o pedido pendente e aprova → dono vira o solicitante, com 'troca_vendedor' no histórico", async () => {
      const { pedidos } = await (await rotaPedidos.GET(req("/api/leads/pedidos", pessoas.admin))).json();
      const pedido = pedidos.find((p: { lead_id: string }) => p.lead_id === parado);
      expect(pedido).toMatchObject({ municipio_nome: "Rolândia", dono_nome: "Beto Vendas", solicitante_nome: "Vera Vendas" });
      const res = await rotaDecisao.POST(req(`/api/leads/pedidos/${pedido.id}`, pessoas.admin, "POST", { decisao: "aprovado" }), ctx(pedido.id));
      expect(res.status).toBe(200);
      const [lead] = await query<{ vendedor_id: string }>(`select vendedor_id from lead where id = $1`, [parado]);
      expect(lead.vendedor_id).toBe(pessoas.vendasA.id);
      const [troca] = await query<{ texto: string; autor_id: string }>(`select texto, autor_id from lead_interacao where lead_id = $1 and tipo = 'troca_vendedor'`, [parado]);
      expect(troca).toEqual({ texto: "De Beto Vendas para Vera Vendas. Pedido de reatribuição aprovado.", autor_id: pessoas.admin.id });
      expect((await rotaDecisao.POST(req(`/api/leads/pedidos/${pedido.id}`, pessoas.admin, "POST", { decisao: "negado" }), ctx(pedido.id))).status).toBe(409);
    });

    it("admin troca vendedor direto; pra quem não pode ser vendedor (financeiro) → 400", async () => {
      expect((await rotaVendedor.POST(req(`/api/leads/${recente}/vendedor`, pessoas.admin, "POST", { vendedor_id: pessoas.financeiro.id }), ctx(recente))).status).toBe(400);
      expect((await rotaVendedor.POST(req(`/api/leads/${recente}/vendedor`, pessoas.admin, "POST", { vendedor_id: pessoas.vendasA.id }), ctx(recente))).status).toBe(200);
    });
  });

  describe("funil sem corte silencioso (rodada 16-A1)", () => {
    it("120 leads em Contato: o funil traz 50 cartões, o total da etapa é 120 e a lista filtrada pela etapa pagina os 120", async () => {
      const c = await conta("vendasC", "vendas", "Carla Vendas");
      await query(
        `insert into lead (municipio_nome, nome_busca, uf, origem, vendedor_id, etapa, valor_mensal_estimado_centavos, proxima_acao_em)
         select 'Funil ' || n, 'funil ' || n, 'SP', 'site', $1, 'contato', 100000, case when n <= 3 then date '2026-01-10' end
         from generate_series(1, 120) n`,
        [c.id]
      );
      const escopo = { equipeId: c.id, admin: false };
      const hoje = "2026-11-18";
      const funil = await repo.listarFunil(escopo, hoje);
      expect(funil.contato).toHaveLength(50);
      expect(funil.contato.slice(0, 3).every((l) => l.acao_vencida)).toBe(true); // ação vencida primeiro
      const resumo = await repo.obterResumoCrm(escopo, hoje);
      expect(resumo.porEtapa.find((e) => e.etapa === "contato")).toEqual({ etapa: "contato", quantidade: 120, valorCentavos: 12000000 });
      const filtro = { etapa: "contato" as const, ordenar: "municipio" as const, direcao: "asc" as const, porPagina: 100 };
      const p1 = await repo.listarLeads({ ...filtro, pagina: 1 }, escopo, hoje);
      const p2 = await repo.listarLeads({ ...filtro, pagina: 2 }, escopo, hoje);
      expect([p1.total, p1.leads.length, p2.leads.length]).toEqual([120, 100, 20]);
      // Isolamento continua no funil: outro vendedor não vê nenhum desses.
      const outro = await repo.listarFunil({ equipeId: pessoas.vendasA.id, admin: false }, hoje);
      expect(outro.contato.some((l) => l.vendedor_id === c.id)).toBe(false);
      // Admin vê os da Carla no total e no máximo 50 cartões na coluna.
      const admin = await repo.listarFunil({ equipeId: pessoas.admin.id, admin: true }, hoje);
      expect(admin.contato.length).toBe(50);
    });
  });

  describe("pedidos concorrentes (rodada 16-A1)", () => {
    it("dois pedidos pendentes; aprovar um nega o outro ('lead já reatribuído'), com histórico; o negado não pode ser aprovado depois (409)", async () => {
      const d = await conta("vendasD", "vendas", "Dora Vendas");
      const lead = await criarId(pessoas.vendasB, { municipio_nome: "Apucarana", uf: "PR" });
      await query(`update lead set criado_em = '2026-08-01T15:00:00Z' where id = $1`, [lead]);
      const hoje = "2026-11-18";
      const pedidoA = await servico.pedirLead(lead, { equipeId: pessoas.vendasA.id, admin: false }, hoje);
      const pedidoD = await servico.pedirLead(lead, { equipeId: d.id, admin: false }, hoje);
      if (!pedidoA.ok || !pedidoD.ok) throw new Error("pedidos deveriam ter sido criados");

      const res = await rotaDecisao.POST(req(`/api/leads/pedidos/${pedidoA.pedidoId}`, pessoas.admin, "POST", { decisao: "aprovado" }), ctx(pedidoA.pedidoId));
      expect(await res.json()).toEqual({ decisao: "aprovado", negados_automaticamente: 1 });
      const pedidos = await query<{ id: string; decisao: string; motivo_decisao: string | null; resolvido_por: string }>(
        `select id, decisao, motivo_decisao, resolvido_por from lead_pedido_reatribuicao where lead_id = $1 order by em`,
        [lead]
      );
      expect(pedidos).toEqual([
        { id: pedidoA.pedidoId, decisao: "aprovado", motivo_decisao: null, resolvido_por: pessoas.admin.id },
        { id: pedidoD.pedidoId, decisao: "negado", motivo_decisao: "lead já reatribuído", resolvido_por: pessoas.admin.id }
      ]);
      const [troca] = await query<{ texto: string }>(`select texto from lead_interacao where lead_id = $1 and tipo = 'troca_vendedor'`, [lead]);
      expect(troca.texto).toBe("De Beto Vendas para Vera Vendas. Pedido de reatribuição aprovado. Outro pedido pendente negado (Dora Vendas): lead já reatribuído.");
      const tarde = await rotaDecisao.POST(req(`/api/leads/pedidos/${pedidoD.pedidoId}`, pessoas.admin, "POST", { decisao: "aprovado" }), ctx(pedidoD.pedidoId));
      expect(tarde.status).toBe(409);
      const [dono] = await query<{ vendedor_id: string }>(`select vendedor_id from lead where id = $1`, [lead]);
      expect(dono.vendedor_id).toBe(pessoas.vendasA.id);
      expect((await (await rotaPedidos.GET(req("/api/leads/pedidos", pessoas.admin))).json()).pedidos.filter((p: { lead_id: string }) => p.lead_id === lead)).toEqual([]);
    });
  });

  describe("exportação XLSX da carteira (rodada 16-A1)", () => {
    it("só crm_gestao; ZIP válido com título e data, fórmulas neutralizadas, valor numérico em moeda, mesmas linhas do CSV", async () => {
      const perigoso = await criarId(pessoas.vendasA, {
        municipio_nome: "=HYPERLINK(1)",
        uf: "MG",
        contato_nome: "+5543999990000",
        contato_cargo: "-Secretário",
        contato_email: "x@cmd.gov.br",
        contato_telefone: "@SOMA(A1)",
        valor_mensal_estimado: "1234,56",
        proxima_acao_em: "2026-12-01",
        proxima_acao_descricao: "=1+1"
      });
      const filtros = "uf=MG&ordenar=municipio&direcao=asc";
      for (const quem of [pessoas.vendasA, pessoas.financeiro]) {
        expect((await rotaExportar.GET(req(`/api/leads/exportar?${filtros}&formato=xlsx`, quem))).status).toBe(403);
      }
      const xlsx = await rotaExportar.GET(req(`/api/leads/exportar?${filtros}&formato=xlsx`, pessoas.admin));
      expect(xlsx.status).toBe(200);
      const arquivos = lerZip(Buffer.from(await xlsx.arrayBuffer()));
      const planilha = arquivos["xl/worksheets/sheet1.xml"];
      expect(planilha).toContain(">NEXAIGEN — Carteira de leads (CRM)<");
      expect(planilha).toMatch(/>Gerado em: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(horário de Brasília\)</);
      for (const neutralizado of ["'=HYPERLINK(1)", "'+5543999990000", "'-Secretário", "'@SOMA(A1)", "'=1+1"]) expect(planilha).toContain(`>${neutralizado}<`);
      expect(planilha).not.toContain("<f>");
      expect(planilha).toMatch(/<c r="G7" s="1"><v>1234\.56<\/v><\/c>/); // valor: número, estilo moeda
      expect(planilha).toContain(">01/12/2026<"); // data da próxima ação
      const csv = await rotaExportar.GET(req(`/api/leads/exportar?${filtros}&formato=csv`, pessoas.admin));
      const linhasCsv = Buffer.from(await csv.arrayBuffer()).subarray(3).toString("utf8").replace(/\r\n$/, "").split("\r\n");
      expect((planilha.match(/<row /g) ?? []).length).toBe(linhasCsv.length);
      expect(linhasCsv.at(-1)).toContain("'=HYPERLINK(1);MG;");
      expect(perigoso).toBeTruthy();
    });
  });

  describe("regras no banco e no SQL", () => {
    it("CHECKs: perdido sem motivo, motivo fora de perdido, descrição sem data, UF e e-mail inválidos, 2 abertos com o mesmo código", async () => {
      const base = `insert into lead (municipio_nome, nome_busca, uf, origem, vendedor_id`;
      const v = pessoas.vendasA.id;
      const casos: [string, unknown[], string][] = [
        [`${base}, etapa) values ('Teste 1', 'teste 1', 'PR', 'site', $1, 'perdido')`, [v], "ck_lead_motivo_perda"],
        [`${base}, motivo_perda) values ('Teste 2', 'teste 2', 'PR', 'site', $1, 'preco')`, [v], "ck_lead_motivo_perda"],
        [`${base}, proxima_acao_descricao) values ('Teste 3', 'teste 3', 'PR', 'site', $1, 'ligar')`, [v], "ck_lead_proxima_acao"],
        [`${base}) values ('Teste 4', 'teste 4', 'XX', 'site', $1)`, [v], "lead_uf_check"],
        [`${base}, contato_email) values ('Teste 5', 'teste 5', 'PR', 'site', $1, 'sem-arroba')`, [v], "lead_contato_email_check"],
        [`${base}, codigo_ibge) values ('Teste 6', 'teste 6', 'PR', 'site', $1, '4112207')`, [v], "uq_lead_codigo_ibge_aberto"]
      ];
      for (const [sql, params, constraint] of casos) await expect(query(sql, params)).rejects.toMatchObject({ constraint });
      // Controle: a mesma linha, válida, entra (os casos acima falham SÓ pelo CHECK que testam).
      await expect(query(`${base}) values ('Teste OK', 'teste ok', 'PR', 'site', $1)`, [v])).resolves.toEqual([]);
    });

    it("'parado' no SQL = regra pura nas bordas (14 dias não, 15 sim) e 'ação vencida'", async () => {
      const a = { equipeId: pessoas.vendasA.id, admin: false };
      const id14 = await criarId(pessoas.vendasA, { municipio_nome: "Borda Catorze", uf: "PR", proxima_acao_em: "2026-11-17", proxima_acao_descricao: "ligar" });
      const id15 = await criarId(pessoas.vendasA, { municipio_nome: "Borda Quinze", uf: "PR", proxima_acao_em: "2026-11-18" });
      await query(`update lead set criado_em = '2026-11-04T15:00:00Z' where id = $1`, [id14]);
      await query(`update lead set criado_em = '2026-11-03T15:00:00Z' where id = $1`, [id15]);
      const filtro = { ordenar: "municipio" as const, direcao: "asc" as const, pagina: 1, porPagina: 100 };
      const todos = (await repo.listarLeads({ ...filtro, busca: "borda" }, a, "2026-11-18")).leads;
      expect(todos.map((l) => [l.municipio_nome, l.parado, l.dias_sem_atividade, l.acao_vencida])).toEqual([
        ["Borda Catorze", false, 14, true],
        ["Borda Quinze", true, 15, false]
      ]);
      const parados = (await repo.listarLeads({ ...filtro, busca: "borda", parados: true }, a, "2026-11-18")).leads.map((l) => l.municipio_nome);
      expect(parados).toEqual(["Borda Quinze"]);
      const vencidas = (await repo.listarLeads({ ...filtro, busca: "borda", vencidas: true }, a, "2026-11-18")).leads.map((l) => l.municipio_nome);
      expect(vencidas).toEqual(["Borda Catorze"]);
    });

    it("exportar: admin baixa CSV com título; vendas 403", async () => {
      const csv = await rotaExportar.GET(req("/api/leads/exportar?formato=csv", pessoas.admin));
      expect(csv.status).toBe(200);
      const texto = Buffer.from(await csv.arrayBuffer()).subarray(3).toString("utf8");
      expect(texto.startsWith("NEXAIGEN — Carteira de leads (CRM)\r\n")).toBe(true);
      expect(texto).toContain("Jaguapitã;PR;4112207;Novo;Beto Vendas;Pequeno Porte;8500,00;Indicação;Secretário B");
      expect((await rotaExportar.GET(req("/api/leads/exportar?formato=csv", pessoas.vendasA))).status).toBe(403);
    });
  });
});
