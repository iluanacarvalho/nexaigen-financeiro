// Cancelamento vindo do nexaigen-educa contra Postgres REAL: 401 (segredo
// errado / ausente), 404 (município sem cliente), registrar/retratar/
// encerrar IDEMPOTENTES (repetir não duplica evento, responde mudou:
// false), 409 em transição inválida, eventos com origem 'educa' e sem
// autor da equipe. Rate limit real (contadores limpos no fim).
//   docker compose up -d && npm run migrate && npm run test:integration

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));

import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { chaveLimite } from "@/lib/rateLimit";
import { somarDias } from "@/lib/estadoNota";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { POST } from "./route";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const SEGREDO = "segredo-de-teste-integracao-cancelamento-real";
const HOJE = hojeEmSaoPaulo(new Date());
const IP = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
const criados: string[] = [];

beforeEach(() => {
  process.env.INTEGRACAO_SECRET = SEGREDO;
});

afterAll(async () => {
  await query(`delete from cliente_prefeitura where id = any($1::uuid[])`, [criados]);
  await query(`delete from rate_limit_contador where chave = any($1::text[])`, [[chaveLimite("integracao:ip", IP), chaveLimite("integracao:falha-auth", IP)]]);
});

async function clienteDoMunicipio(): Promise<{ id: string; municipio: string }> {
  const municipio = randomUUID();
  const [{ id }] = await query<{ id: string }>(
    `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, municipio_id_externo) values ($1, 'PR', 1000, '2026-01-01', $2) returning id`,
    [`Prefeitura Integração Cancelamento ${municipio.slice(0, 8)}`, municipio]
  );
  criados.push(id);
  return { id, municipio };
}

function chamar(municipio: string, corpo: unknown, segredo: string | null = SEGREDO) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": IP };
  if (segredo !== null) headers.authorization = `Bearer ${segredo}`;
  return POST(new NextRequest(`http://localhost:3001/api/integracao/clientes/${municipio}/cancelamento`, { method: "POST", headers, body: JSON.stringify(corpo) }), {
    params: Promise.resolve({ municipioIdExterno: municipio })
  });
}

async function eventos(clienteId: string) {
  return query<{ tipo: string; data_evento: string; origem: string; equipe_id: string | null }>(
    `select tipo, data_evento, origem, equipe_id from cliente_evento_contrato where cliente_id = $1 order by criado_em, id`,
    [clienteId]
  );
}

describe("POST /api/integracao/clientes/[municipioIdExterno]/cancelamento — Postgres real", () => {
  it("401 sem segredo ou com segredo errado — nada muda", async () => {
    const { id, municipio } = await clienteDoMunicipio();
    expect((await chamar(municipio, { acao: "registrar", dataPedido: HOJE }, null)).status).toBe(401);
    expect((await chamar(municipio, { acao: "registrar", dataPedido: HOJE }, "errado")).status).toBe(401);
    const [{ status_contrato }] = await query<{ status_contrato: string }>(`select status_contrato from cliente_prefeitura where id = $1`, [id]);
    expect(status_contrato).toBe("ativo");
    expect(await eventos(id)).toEqual([]);
  });

  it("404 com mensagem clara pra município sem cliente (e pra id que nem é uuid)", async () => {
    const res = await chamar(randomUUID(), { acao: "retratar" });
    expect(res.status).toBe(404);
    expect((await res.json()).erro).toMatch(/Nenhum cliente do Financeiro está vinculado a este município/);
    expect((await chamar("nao-e-uuid", { acao: "retratar" })).status).toBe(404);
  });

  it("registrar 2× com a mesma data → um evento só (mudou true, depois false); outra data → 409; retratar 2× → um evento", async () => {
    const { id, municipio } = await clienteDoMunicipio();
    const pedido = somarDias(HOJE, -3);

    const primeira = await chamar(municipio, { acao: "registrar", dataPedido: pedido, motivo: "Ofício do município" });
    expect(primeira.status).toBe(200);
    expect(await primeira.json()).toEqual({ clienteId: id, statusContrato: "em_aviso_previo", pedidoEm: pedido, terminoEm: somarDias(pedido, 30), mudou: true });
    const repetida = await chamar(municipio, { acao: "registrar", dataPedido: pedido, motivo: "Ofício do município" });
    expect(repetida.status).toBe(200);
    expect((await repetida.json()).mudou).toBe(false);
    expect((await chamar(municipio, { acao: "registrar", dataPedido: somarDias(pedido, -1) })).status).toBe(409);

    expect((await (await chamar(municipio, { acao: "retratar" })).json()).mudou).toBe(true);
    const retratarDeNovo = await chamar(municipio, { acao: "retratar" });
    expect(retratarDeNovo.status).toBe(200);
    expect(await retratarDeNovo.json()).toMatchObject({ statusContrato: "ativo", mudou: false });

    expect((await eventos(id)).map((e) => [e.tipo, e.origem, e.equipe_id])).toEqual([
      ["cancelamento_registrado", "educa", null],
      ["cancelamento_retratado", "educa", null]
    ]);
  });

  it("retratar sem nunca ter cancelado → 409", async () => {
    const { municipio } = await clienteDoMunicipio();
    expect((await chamar(municipio, { acao: "retratar" })).status).toBe(409);
  });

  it("encerrar: antes do término sem imediato → 409; imediato → encerrado (data de hoje); repetir → mudou false, sem evento novo", async () => {
    const { id, municipio } = await clienteDoMunicipio();
    await chamar(municipio, { acao: "registrar", dataPedido: somarDias(HOJE, -2) });

    const cedo = await chamar(municipio, { acao: "encerrar" });
    expect(cedo.status).toBe(409);
    expect((await cedo.json()).erro).toMatch(/imediato: true/);

    const agora = await chamar(municipio, { acao: "encerrar", imediato: true, motivo: "Rescisão amigável" });
    expect(agora.status).toBe(200);
    expect(await agora.json()).toMatchObject({ statusContrato: "encerrado", mudou: true, terminoEm: somarDias(HOJE, 28) });
    expect((await (await chamar(municipio, { acao: "encerrar", imediato: true })).json()).mudou).toBe(false);
    // Encerrado não volta por retratação.
    expect((await chamar(municipio, { acao: "retratar" })).status).toBe(409);

    const evs = await eventos(id);
    expect(evs.map((e) => [e.tipo, e.data_evento, e.origem])).toEqual([
      ["cancelamento_registrado", somarDias(HOJE, -2), "educa"],
      ["contrato_encerrado", HOJE, "educa"]
    ]);
  });

  it("encerrar depois do término (job ainda não rodou) → encerra com a data do término, sem precisar de imediato", async () => {
    const { id, municipio } = await clienteDoMunicipio();
    const pedido = somarDias(HOJE, -40);
    await query(`update cliente_prefeitura set status_contrato = 'em_aviso_previo', cancelamento_pedido_em = $1, cancelamento_termino_em = $2 where id = $3`, [pedido, somarDias(pedido, 30), id]);
    const res = await chamar(municipio, { acao: "encerrar" });
    expect(res.status).toBe(200);
    expect((await res.json()).statusContrato).toBe("encerrado");
    expect((await eventos(id)).map((e) => [e.tipo, e.data_evento])).toEqual([["contrato_encerrado", somarDias(pedido, 30)]]);
  });
});
