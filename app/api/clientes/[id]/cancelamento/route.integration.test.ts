// Cancelamento de contrato pela equipe contra Postgres REAL, pelas rotas
// HTTP reais (sessão de verdade): registrar → em aviso prévio (+ evento
// com autor); repetir → 409 sem evento novo; retratar (até o término,
// inclusive) → ativo; retratar depois do término → 409; ofício antigo →
// encerra na hora; nota de mensalidade depois do término → 409; nota final
// em aviso e depois de encerrado → 201; GET /api/clientes marca
// nota_final_emitida; Dashboard e Painel com os MESMOS números de aviso
// prévio e MRR. O banco local pode ter outros dados: as checagens de valor
// são sobre os clientes criados aqui.
//   docker compose up -d && npm run migrate && npm run test:integration

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));

import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { somarDias } from "@/lib/estadoNota";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { competenciaNotaFinal, valorNotaFinalCentavos } from "@/lib/cancelamentoContrato";
import { centavosParaNumeric, paraCentavos } from "@/lib/dinheiro";
import { obterResumoDashboard } from "@/lib/resumoDashboard";
import { DELETE as RETRATAR, POST as REGISTRAR } from "./route";
import { GET as LISTAR_CLIENTES } from "@/app/api/clientes/route";
import { POST as CRIAR_NOTA } from "@/app/api/notas/route";
import { GET as PAINEL } from "@/app/api/painel-financeiro/route";

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

/** Cliente direto no banco (inicio 2026-01-01, R$ 8.500,00). `cancelamento` grava status + pedido/término (término = pedido + 30, CHECK da 0011). */
async function criarCliente(status = "ativo", pedido: string | null = null): Promise<string> {
  const [{ id }] = await query<{ id: string }>(
    `insert into cliente_prefeitura (nome, uf, plano, valor_mensal, data_inicio_contrato, status_contrato, cancelamento_pedido_em, cancelamento_termino_em)
     values ($1, 'PR', 'dispensa', 8500, '2026-01-01', $2, $3::date, $3::date + 30) returning id`,
    [`Prefeitura Cancelamento ${sufixo} ${clientes.length}`, status, pedido]
  );
  clientes.push(id);
  return id;
}

async function lerCliente(id: string) {
  const [c] = await query<{ status_contrato: string; cancelamento_pedido_em: string | null; cancelamento_termino_em: string | null; cancelamento_motivo: string | null }>(
    `select status_contrato, cancelamento_pedido_em, cancelamento_termino_em, cancelamento_motivo from cliente_prefeitura where id = $1`,
    [id]
  );
  return c;
}

async function eventos(id: string) {
  return query<{ tipo: string; data_evento: string; detalhe: string | null; equipe_id: string | null; origem: string }>(
    `select tipo, data_evento, detalhe, equipe_id, origem from cliente_evento_contrato where cliente_id = $1 order by criado_em, id`,
    [id]
  );
}

beforeAll(async () => {
  const [e] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria) values ('Pessoa Cancelamento', $1, 'x', false) returning id, token_version`,
    [`cancelamento-${sufixo}@teste.nexaigen.invalid`]
  );
  equipeId = e.id;
  cookie = `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId, nome: "Pessoa Cancelamento", precisaTrocarSenha: false, tokenVersion: e.token_version })}`;
});

afterAll(async () => {
  await query(`delete from cliente_prefeitura where id = any($1::uuid[])`, [clientes]);
  await query(`delete from equipe_nexaigen where id = $1`, [equipeId]);
});

describe("registrar e retratar pela tela de Clientes", () => {
  it("registrar → em_aviso_previo com término = pedido + 30 e evento com autor; repetir → 409 sem evento novo", async () => {
    const id = await criarCliente();
    const pedido = somarDias(HOJE, -5);
    const res = await REGISTRAR(req(`/api/clientes/${id}/cancelamento`, { method: "POST", corpo: { dataPedido: pedido, motivo: "Ofício 7/2026" } }), comId(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ statusContrato: "em_aviso_previo", pedidoEm: pedido, terminoEm: somarDias(pedido, 30) });
    expect(await lerCliente(id)).toEqual({ status_contrato: "em_aviso_previo", cancelamento_pedido_em: pedido, cancelamento_termino_em: somarDias(pedido, 30), cancelamento_motivo: "Ofício 7/2026" });
    expect(await eventos(id)).toEqual([{ tipo: "cancelamento_registrado", data_evento: pedido, detalhe: "Ofício 7/2026", equipe_id: equipeId, origem: "painel" }]);

    const repetido = await REGISTRAR(req(`/api/clientes/${id}/cancelamento`, { method: "POST", corpo: { dataPedido: pedido, motivo: "Ofício 7/2026" } }), comId(id));
    expect(repetido.status).toBe(409);
    const outraData = await REGISTRAR(req(`/api/clientes/${id}/cancelamento`, { method: "POST", corpo: { dataPedido: somarDias(pedido, -1), motivo: "x" } }), comId(id));
    expect(outraData.status).toBe(409);
    expect((await outraData.json()).erro).toMatch(/já está em aviso prévio/);
    expect(await eventos(id)).toHaveLength(1);
  });

  it("retratar NO DIA do término → ativo, campos limpos, evento; retratar de novo → 409", async () => {
    const id = await criarCliente();
    const pedido = somarDias(HOJE, -30); // término = hoje
    expect((await REGISTRAR(req(`/api/clientes/${id}/cancelamento`, { method: "POST", corpo: { dataPedido: pedido, motivo: "Ofício" } }), comId(id))).status).toBe(200);
    expect((await lerCliente(id)).status_contrato).toBe("em_aviso_previo"); // o dia do término ainda é de contrato

    const res = await RETRATAR(req(`/api/clientes/${id}/cancelamento`, { method: "DELETE" }), comId(id));
    expect(res.status).toBe(200);
    expect(await lerCliente(id)).toEqual({ status_contrato: "ativo", cancelamento_pedido_em: null, cancelamento_termino_em: null, cancelamento_motivo: null });
    const evs = await eventos(id);
    expect(evs.map((e) => [e.tipo, e.data_evento, e.origem, e.equipe_id])).toEqual([
      ["cancelamento_registrado", pedido, "painel", equipeId],
      ["cancelamento_retratado", HOJE, "painel", equipeId]
    ]);
    expect(evs[1].detalhe).toMatch(/término previsto em/);

    expect((await RETRATAR(req(`/api/clientes/${id}/cancelamento`, { method: "DELETE" }), comId(id))).status).toBe(409);
    expect(await eventos(id)).toHaveLength(2);
  });

  it("ofício recebido há mais de 30 dias → encerra na hora (dois eventos); retratar → 409", async () => {
    const id = await criarCliente();
    const pedido = somarDias(HOJE, -31);
    const res = await REGISTRAR(req(`/api/clientes/${id}/cancelamento`, { method: "POST", corpo: { dataPedido: pedido, motivo: "Ofício antigo" } }), comId(id));
    expect(res.status).toBe(200);
    expect((await res.json()).statusContrato).toBe("encerrado");
    expect((await eventos(id)).map((e) => [e.tipo, e.data_evento])).toEqual([
      ["cancelamento_registrado", pedido],
      ["contrato_encerrado", somarDias(pedido, 30)]
    ]);
    const retratar = await RETRATAR(req(`/api/clientes/${id}/cancelamento`, { method: "DELETE" }), comId(id));
    expect(retratar.status).toBe(409);
  });

  it("aviso com término já passado (job ainda não rodou) → retratar 409", async () => {
    const id = await criarCliente("em_aviso_previo", somarDias(HOJE, -31));
    const res = await RETRATAR(req(`/api/clientes/${id}/cancelamento`, { method: "DELETE" }), comId(id));
    expect(res.status).toBe(409);
    expect((await res.json()).erro).toMatch(/retratação só é possível até a data de término/);
  });

  it("dados inválidos → 400 (futuro / antes do início); cliente inexistente → 404; suspenso → 409", async () => {
    const id = await criarCliente();
    const futuro = await REGISTRAR(req(`/api/clientes/${id}/cancelamento`, { method: "POST", corpo: { dataPedido: somarDias(HOJE, 1), motivo: "x" } }), comId(id));
    expect(futuro.status).toBe(400);
    expect((await futuro.json()).detalhes.fieldErrors.dataPedido[0]).toMatch(/futuro/);
    const antes = await REGISTRAR(req(`/api/clientes/${id}/cancelamento`, { method: "POST", corpo: { dataPedido: "2025-12-31", motivo: "x" } }), comId(id));
    expect(antes.status).toBe(400);
    const inexistente = randomUUID();
    expect((await REGISTRAR(req(`/api/clientes/${inexistente}/cancelamento`, { method: "POST", corpo: { dataPedido: HOJE, motivo: "x" } }), comId(inexistente))).status).toBe(404);
    const suspenso = await criarCliente("suspenso");
    expect((await REGISTRAR(req(`/api/clientes/${suspenso}/cancelamento`, { method: "POST", corpo: { dataPedido: HOJE, motivo: "x" } }), comId(suspenso))).status).toBe(409);
    expect(await eventos(id)).toEqual([]);
  });
});

describe("notas com aviso prévio", () => {
  it("em aviso: nota final (competência do último período, valor proporcional) → 201; mês seguinte → 409; GET /api/clientes marca nota_final_emitida", async () => {
    const pedido = somarDias(HOJE, -60); // término há 30 dias — ainda em aviso (o job não rodou)
    const termino = somarDias(pedido, 30);
    const id = await criarCliente("em_aviso_previo", pedido);
    const competencia = competenciaNotaFinal("2026-01-01", termino);
    const mesSeguinte = `${somarDias(competencia, 31).slice(0, 7)}-01`;

    const listar = async () => ((await (await LISTAR_CLIENTES(req("/api/clientes"))).json()).clientes as { id: string; nota_final_emitida?: boolean }[]).find((c) => c.id === id)!;
    expect((await listar()).nota_final_emitida).toBe(false);

    const depois = await CRIAR_NOTA(req("/api/notas", { method: "POST", corpo: { cliente_id: id, competencia: mesSeguinte.slice(0, 7), valor: "8500" } }));
    expect(depois.status).toBe(409);
    expect((await depois.json()).erro).toMatch(new RegExp(`última competência que pode ser cobrada é ${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`));

    const valor = centavosParaNumeric(valorNotaFinalCentavos(850000, "2026-01-01", termino));
    const final = await CRIAR_NOTA(req("/api/notas", { method: "POST", corpo: { cliente_id: id, competencia: competencia.slice(0, 7), valor } }));
    expect(final.status).toBe(201);
    expect((await listar()).nota_final_emitida).toBe(true);
  });

  it("encerrado POR AVISO PRÉVIO ainda aceita a nota final; encerrado sem término e suspenso → 409", async () => {
    const pedido = somarDias(HOJE, -45);
    const encerrado = await criarCliente("encerrado", pedido);
    const competencia = competenciaNotaFinal("2026-01-01", somarDias(pedido, 30));
    expect((await CRIAR_NOTA(req("/api/notas", { method: "POST", corpo: { cliente_id: encerrado, competencia: competencia.slice(0, 7), valor: "100" } }))).status).toBe(201);

    for (const status of ["encerrado", "suspenso"]) {
      const id = await criarCliente(status);
      const res = await CRIAR_NOTA(req("/api/notas", { method: "POST", corpo: { cliente_id: id, competencia: HOJE.slice(0, 7), valor: "100" } }));
      expect(res.status).toBe(409);
      expect((await res.json()).erro).toMatch(/ativo ou em aviso prévio/);
    }
  });
});

describe("Painel e Dashboard batem nos números de aviso prévio", () => {
  it("contrato em aviso entra no MRR e no cartão; encerrado sai do MRR mas fica na tabela; Dashboard = Painel", async () => {
    const emAviso = await criarCliente("em_aviso_previo", somarDias(HOJE, -10));
    const encerrado = await criarCliente("encerrado", somarDias(HOJE, -50));
    const [resumo, api] = await Promise.all([obterResumoDashboard(), PAINEL(req("/api/painel-financeiro")).then((r) => r.json())]);

    expect(resumo.avisoPrevio).toEqual(api.kpis.avisoPrevio);
    expect(api.kpis.avisoPrevio.quantidade).toBeGreaterThanOrEqual(1);
    expect(api.kpis.avisoPrevio.mrrEmRiscoCentavos).toBeGreaterThanOrEqual(850000);

    // MRR = ativos + em aviso (banco inteiro, mesma conta feita aqui em SQL independente).
    const [{ mrr }] = await query<{ mrr: string }>(
      `select coalesce(sum(valor_mensal), 0)::text as mrr from cliente_prefeitura
       where status_contrato = 'ativo' or (status_contrato = 'em_aviso_previo' and cancelamento_termino_em >= $1::date)`,
      [HOJE]
    );
    expect(api.kpis.mrr.valorCentavos).toBe(paraCentavos(mrr));

    const linhas = api.clientes as { id: string; statusContrato: string; terminoAvisoPrevio: string | null }[];
    expect(linhas.find((c) => c.id === emAviso)).toMatchObject({ statusContrato: "em_aviso_previo", terminoAvisoPrevio: somarDias(HOJE, 20) });
    expect(linhas.find((c) => c.id === encerrado)).toMatchObject({ statusContrato: "encerrado" });
  });
});
