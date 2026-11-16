// Ciclo de vida da nota contra Postgres REAL, só pelas rotas HTTP reais
// (sessão de verdade): cria cliente → cria nota → atesta → paga → reabre;
// e cria → cancela. Em CADA passo confere que o Dashboard (o que a página
// renderiza — lib/resumoDashboard.ts e o HTML da própria página) e
// GET /api/painel-financeiro dão o MESMO "em aberto" e a MESMA contagem
// por situação (Parte 2: uma única fonte de números), e no fim o histórico
// de eventos com autor. O banco local pode ter outros dados: as
// comparações Dashboard × API são sobre o banco inteiro (mesmo estado, no
// mesmo instante — fileParallelism: false), as checagens de valor são
// sobre o cliente criado aqui.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/armazenamentoObjetos", async () => (await import("@/testes/bucketEmMemoria")).armazenamentoEmMemoria);
vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));

import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { query } from "@/lib/db";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { formatarMoeda } from "@/lib/dinheiro";
import { somarDias } from "@/lib/estadoNota";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { obterResumoDashboard } from "@/lib/resumoDashboard";
import { POST as CRIAR_CLIENTE } from "@/app/api/clientes/route";
import { GET as LISTAR_NOTAS, POST as CRIAR_NOTA } from "@/app/api/notas/route";
import { POST as ACAO } from "@/app/api/notas/[id]/acoes/route";
import { GET as EVENTOS } from "@/app/api/notas/[id]/eventos/route";
import { GET as PAINEL } from "@/app/api/painel-financeiro/route";
import Dashboard from "@/app/(protegido)/page";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const HOJE = hojeEmSaoPaulo(new Date());
const sufixo = randomUUID().slice(0, 8);
let cookie: string;
let equipeId: string;
const clientes: string[] = [];

const req = (url: string, init: { method?: string; corpo?: unknown } = {}) =>
  new NextRequest(`http://localhost:3001${url}`, {
    method: init.method ?? "GET",
    headers: { cookie, "content-type": "application/json" },
    body: init.corpo === undefined ? undefined : JSON.stringify(init.corpo)
  });
const comId = (id: string) => ({ params: Promise.resolve({ id }) });

async function criarCliente(): Promise<string> {
  const res = await CRIAR_CLIENTE(
    req("/api/clientes", {
      method: "POST",
      corpo: { nome: `Prefeitura Ciclo ${sufixo} ${clientes.length}`, uf: "PR", plano: "dispensa", valor_mensal: "3000", data_inicio_contrato: "2026-01-01" }
    })
  );
  const { id } = await res.json();
  clientes.push(id);
  return id;
}

/** Dashboard × API no mesmo estado do banco: mesmo em aberto, mesma contagem por situação (e o HTML da página mostra o mesmo valor). */
async function conferirConsistencia() {
  const [resumo, api] = await Promise.all([obterResumoDashboard(), PAINEL(req("/api/painel-financeiro")).then((r) => r.json())]);
  expect(resumo.emAbertoCentavos).toBe(api.kpis.aReceber?.totalCentavos ?? null);
  expect(resumo.contagemPorSituacao).toEqual(api.kpis.contagemPorSituacao);
  const html = renderToStaticMarkup(await Dashboard());
  expect(html).toContain(formatarMoeda(resumo.emAbertoCentavos));
  return api;
}

function linhaDoCliente(api: { clientes: { id: string; notasEmAberto: number; valorEmAbertoCentavos: number }[] }, clienteId: string) {
  return api.clientes.find((c) => c.id === clienteId)!;
}

async function situacaoNaLista(notaId: string, clienteId: string): Promise<string> {
  const { notas } = await (await LISTAR_NOTAS(req(`/api/notas?cliente_id=${clienteId}`))).json();
  return notas.find((n: { id: string }) => n.id === notaId).situacao;
}

beforeAll(async () => {
  const [e] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria) values ('Pessoa Ciclo', $1, 'x', false) returning id, token_version`,
    [`ciclo-${sufixo}@teste.nexaigen.invalid`]
  );
  equipeId = e.id;
  cookie = `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId, nome: "Pessoa Ciclo", precisaTrocarSenha: false, tokenVersion: e.token_version })}`;
});

afterAll(async () => {
  await query(`delete from cliente_prefeitura where id = any($1::uuid[])`, [clientes]);
  await query(`delete from equipe_nexaigen where id = $1`, [equipeId]);
});

describe("ciclo de vida da nota — rotas reais, Postgres real", () => {
  it("cria → atesta → paga → reabre: Painel e Dashboard coerentes em cada passo; histórico completo com autor", async () => {
    const clienteId = await criarCliente();
    let api = await conferirConsistencia();
    expect(linhaDoCliente(api, clienteId)).toMatchObject({ notasEmAberto: 0, valorEmAbertoCentavos: 0 });

    // 1. cria (valor como TEXTO, competência normalizada pro 1º do mês)
    const criada = await CRIAR_NOTA(
      req("/api/notas", { method: "POST", corpo: { cliente_id: clienteId, competencia: HOJE.slice(0, 7), numero_nf: `CV-${sufixo}`, valor: "2500,75", data_emissao: somarDias(HOJE, -10) } })
    );
    expect(criada.status).toBe(201);
    const { id: notaId } = await criada.json();
    api = await conferirConsistencia();
    expect(linhaDoCliente(api, clienteId)).toMatchObject({ notasEmAberto: 1, valorEmAbertoCentavos: 250075 });
    expect(await situacaoNaLista(notaId, clienteId)).toBe("aguardando_atesto");

    // 2. atesta
    const atesto = await ACAO(req(`/api/notas/${notaId}/acoes`, { method: "POST", corpo: { acao: "registrar_atesto", data: somarDias(HOJE, -5) } }), comId(notaId));
    expect(await atesto.json()).toMatchObject({ ok: true, status_anterior: "aguardando_atesto", status_novo: "atestada" });
    api = await conferirConsistencia();
    expect(linhaDoCliente(api, clienteId)).toMatchObject({ notasEmAberto: 1, valorEmAbertoCentavos: 250075 });
    expect(await situacaoNaLista(notaId, clienteId)).toBe("atestada");

    // 3. paga
    const pagamento = await ACAO(req(`/api/notas/${notaId}/acoes`, { method: "POST", corpo: { acao: "registrar_pagamento", data: HOJE } }), comId(notaId));
    expect(pagamento.status).toBe(200);
    api = await conferirConsistencia();
    expect(linhaDoCliente(api, clienteId)).toMatchObject({ notasEmAberto: 0, valorEmAbertoCentavos: 0 });
    expect(await situacaoNaLista(notaId, clienteId)).toBe("paga");
    expect(api.kpis.recebidoMesCentavos).toBeGreaterThanOrEqual(250075);

    // pagar de novo → 409 (máquina de estados)
    expect((await ACAO(req(`/api/notas/${notaId}/acoes`, { method: "POST", corpo: { acao: "registrar_pagamento", data: HOJE } }), comId(notaId))).status).toBe(409);

    // 4. reabre (pagamento registrado por engano) — motivo obrigatório
    expect((await ACAO(req(`/api/notas/${notaId}/acoes`, { method: "POST", corpo: { acao: "reabrir_pagamento" } }), comId(notaId))).status).toBe(400);
    const reabre = await ACAO(req(`/api/notas/${notaId}/acoes`, { method: "POST", corpo: { acao: "reabrir_pagamento", motivo: "Pagamento era de outra nota" } }), comId(notaId));
    expect(await reabre.json()).toMatchObject({ ok: true, status_anterior: "paga", status_novo: "atestada" });
    api = await conferirConsistencia();
    expect(linhaDoCliente(api, clienteId)).toMatchObject({ notasEmAberto: 1, valorEmAbertoCentavos: 250075 });

    const { eventos } = await (await EVENTOS(req(`/api/notas/${notaId}/eventos`), comId(notaId))).json();
    expect(eventos.map((e: { tipo: string; feito_por_nome: string }) => [e.tipo, e.feito_por_nome])).toEqual([
      ["criacao", "Pessoa Ciclo"],
      ["atesto", "Pessoa Ciclo"],
      ["pagamento", "Pessoa Ciclo"],
      ["reabertura_pagamento", "Pessoa Ciclo"]
    ]);
    expect(eventos[3]).toMatchObject({ motivo: "Pagamento era de outra nota", data_evento: HOJE, status_anterior: "paga", status_novo: "atestada" });
  });

  it("cria → cancela: some do em aberto, situação cancelada, motivo e autor no histórico; cancelada não pode ser paga", async () => {
    const clienteId = await criarCliente();
    const criada = await CRIAR_NOTA(req("/api/notas", { method: "POST", corpo: { cliente_id: clienteId, competencia: HOJE.slice(0, 7), valor: "999", data_emissao: HOJE } }));
    const { id: notaId } = await criada.json();
    let api = await conferirConsistencia();
    expect(linhaDoCliente(api, clienteId)).toMatchObject({ notasEmAberto: 1, valorEmAbertoCentavos: 99900 });

    expect((await ACAO(req(`/api/notas/${notaId}/acoes`, { method: "POST", corpo: { acao: "cancelar", motivo: "   " } }), comId(notaId))).status).toBe(400);
    const cancela = await ACAO(req(`/api/notas/${notaId}/acoes`, { method: "POST", corpo: { acao: "cancelar", motivo: "NF emitida com CNPJ errado" } }), comId(notaId));
    expect(cancela.status).toBe(200);

    api = await conferirConsistencia();
    expect(linhaDoCliente(api, clienteId)).toMatchObject({ notasEmAberto: 0, valorEmAbertoCentavos: 0 });
    expect(await situacaoNaLista(notaId, clienteId)).toBe("cancelada");
    expect((await ACAO(req(`/api/notas/${notaId}/acoes`, { method: "POST", corpo: { acao: "registrar_atesto", data: HOJE } }), comId(notaId))).status).toBe(409);

    const { eventos } = await (await EVENTOS(req(`/api/notas/${notaId}/eventos`), comId(notaId))).json();
    expect(eventos.map((e: { tipo: string }) => e.tipo)).toEqual(["criacao", "cancelamento"]);
    expect(eventos[1]).toMatchObject({ motivo: "NF emitida com CNPJ errado", feito_por_nome: "Pessoa Ciclo", status_novo: "cancelada" });
  });

  it("criação recusada com motivos claros: valor numérico (float) no JSON, competência absurda, cliente suspenso (409), número repetido (409)", async () => {
    const clienteId = await criarCliente();
    const criar = (corpo: object) => CRIAR_NOTA(req("/api/notas", { method: "POST", corpo: { cliente_id: clienteId, competencia: HOJE.slice(0, 7), valor: "10", ...corpo } }));

    expect((await criar({ valor: 10.5 })).status).toBe(400);
    const absurda = await criar({ competencia: "1990-01" });
    expect(absurda.status).toBe(400);
    // Regra de negócio também no formato de contrato de `detalhes` (lista de mensagens por campo + formErrors).
    const detalhesAbsurda = (await absurda.json()).detalhes;
    expect(detalhesAbsurda.formErrors).toEqual([]);
    expect(detalhesAbsurda.fieldErrors.competencia[0]).toMatch(/2000/);
    expect((await criar({ valor: "10,123" })).status).toBe(400);
    expect((await criar({ data_emissao: somarDias(HOJE, 1) })).status).toBe(400);

    expect((await criar({ numero_nf: `REP-${sufixo}` })).status).toBe(201);
    const repetida = await criar({ numero_nf: `REP-${sufixo}` });
    expect(repetida.status).toBe(409);
    expect((await repetida.json()).erro).toMatch(/Já existe uma nota com este número/);

    await query(`update cliente_prefeitura set status_contrato = 'suspenso' where id = $1`, [clienteId]);
    const suspenso = await criar({});
    expect(suspenso.status).toBe(409);
    expect((await suspenso.json()).erro).toMatch(/suspenso/);
  });

  it("GET /api/notas: filtros validados (400 em parâmetro desconhecido, por_pagina acima do máximo, situação inválida)", async () => {
    for (const qs of ["?foo=1", "?por_pagina=101", "?situacao=quase_paga", "?competencia=2026-13", "?cliente_id=nao-uuid", "?ordenar=senha_hash"]) {
      expect((await LISTAR_NOTAS(req(`/api/notas${qs}`))).status).toBe(400);
    }
  });
});
