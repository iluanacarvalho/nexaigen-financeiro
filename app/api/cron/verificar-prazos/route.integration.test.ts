// Fluxo completo do job de cron contra Postgres REAL — a rodada de
// migração de infraestrutura (Supabase → pg direto) tocou exatamente a
// lógica mais delicada desta rota (o upsert condicional que decide
// "notificar ou não" via `on conflict ... do nothing returning id"). Um
// mock de `@/lib/db` já provava a lógica de alto nível, mas não provava
// que o predicado do `on conflict` bate de verdade com o índice único
// parcial `uq_alerta_ativo` do schema real — só um Postgres de verdade
// prova isso. Mocka SOMENTE a camada de envio de e-mail
// (lib/notificacao-interna.ts / lib/notificacaoCliente.ts), nunca o banco.
//
// Depende do Postgres real do Docker Compose estar no ar e migrado:
//   docker compose up -d && npm run migrate && npm run test:integration

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { somarDias } from "@/lib/estadoNota";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";

vi.mock("@/lib/notificacao-interna", () => ({
  notificarTimeDeCobranca: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("@/lib/notificacaoCliente", () => ({
  notificarClientePrefeitura: vi.fn().mockResolvedValue(true)
}));

import { notificarTimeDeCobranca } from "@/lib/notificacao-interna";
import { notificarClientePrefeitura } from "@/lib/notificacaoCliente";
import { POST } from "./route";

const CRON_SECRET = "segredo-teste-integracao-cron";

function requisicao(): NextRequest {
  return new NextRequest("http://localhost:3001/api/cron/verificar-prazos", {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` }
  });
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

let clienteId: string;
let notaId: string;

beforeAll(() => {
  process.env.CRON_SECRET = CRON_SECRET;
});

beforeEach(async () => {
  vi.clearAllMocks();

  const clientes = await query<{ id: string }>(
    `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, contato_email)
     values ($1, 'SP', 2000, current_date, 'financeiro@prefeitura-teste.example.gov.br') returning id`,
    [`Prefeitura Teste Cron ${randomUUID().slice(0, 8)}`]
  );
  clienteId = clientes[0].id;

  // Atestada há 95 dias: vence em atesto+30 dias, ou seja, ~65 dias em
  // atraso — passa do LIMIAR_ATRASO_CRITICO_DIAS (60, lib/prazos.ts),
  // disparando tipo "atraso_60_dias" (aciona AS DUAS notificações: time
  // interno + cliente). Margem de 5 dias acima do limiar de propósito,
  // pra tolerar variação de fuso/hora entre `current_date` (Postgres) e
  // `new Date()` (Node, usado como "hoje" padrão por diagnosticarNota).
  const notas = await query<{ id: string }>(
    `insert into nota_fiscal (cliente_id, competencia, valor, numero_nf, data_atesto)
     values ($1, current_date, '3500.00', 'NF-INTEG-001', current_date - interval '95 days')
     returning id`,
    [clienteId]
  );
  notaId = notas[0].id;
});

afterAll(async () => {
  await query(`delete from cliente_prefeitura where nome like 'Prefeitura Teste Cron %'`);
});

describe("POST /api/cron/verificar-prazos — fluxo completo contra Postgres real", () => {
  it("primeira execução: gera alerta atraso_60_dias, atualiza status e notifica os dois canais", async () => {
    const resposta = await POST(requisicao());
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.alertasCriados).toBeGreaterThanOrEqual(1);

    const alertas = await query<{ tipo: string; status: string }>(
      `select tipo, status from alerta_cobranca where nota_fiscal_id = $1`,
      [notaId]
    );
    expect(alertas).toHaveLength(1);
    expect(alertas[0].tipo).toBe("atraso_60_dias");
    expect(alertas[0].status).toBe("pendente");

    const notas = await query<{ status: string }>(`select status from nota_fiscal where id = $1`, [notaId]);
    expect(notas[0].status).toBe("atraso_critico");

    expect(notificarTimeDeCobranca).toHaveBeenCalledTimes(1);
    expect(notificarTimeDeCobranca).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "atraso_60_dias", numeroNf: "NF-INTEG-001", valor: 3500 })
    );
    expect(notificarClientePrefeitura).toHaveBeenCalledTimes(1);
    expect(notificarClientePrefeitura).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "atraso_60_dias", contatoEmail: "financeiro@prefeitura-teste.example.gov.br" })
    );
  });

  it("segunda execução no mesmo dia: não duplica o alerta nem reenvia e-mail — uq_alerta_ativo real barra o INSERT", async () => {
    const primeira = await POST(requisicao());
    expect((await primeira.json()).alertasCriados).toBeGreaterThanOrEqual(1);
    vi.clearAllMocks();

    const segunda = await POST(requisicao());
    const corpoSegunda = await segunda.json();

    expect(segunda.status).toBe(200);
    expect(corpoSegunda.alertasCriados).toBe(0);

    const alertas = await query<{ id: string }>(`select id from alerta_cobranca where nota_fiscal_id = $1`, [notaId]);
    expect(alertas).toHaveLength(1); // continua sendo só UMA linha real na tabela

    expect(notificarTimeDeCobranca).not.toHaveBeenCalled();
    expect(notificarClientePrefeitura).not.toHaveBeenCalled();
  });

  it("resolver o alerta manualmente e rodar de novo cria um novo ciclo (índice parcial libera, status <> 'resolvido')", async () => {
    await POST(requisicao());
    vi.clearAllMocks();

    await query(`update alerta_cobranca set status = 'resolvido', resolvido_em = now() where nota_fiscal_id = $1`, [notaId]);

    const terceira = await POST(requisicao());
    const corpo = await terceira.json();
    expect(corpo.alertasCriados).toBeGreaterThanOrEqual(1);

    const alertas = await query<{ status: string }>(
      `select status from alerta_cobranca where nota_fiscal_id = $1 order by gerado_em asc`,
      [notaId]
    );
    expect(alertas).toHaveLength(2);
    expect(alertas[0].status).toBe("resolvido");
    expect(alertas[1].status).toBe("pendente");

    expect(notificarTimeDeCobranca).toHaveBeenCalledTimes(1);
    expect(notificarClientePrefeitura).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/cron/verificar-prazos — aviso prévio (rodada 12-A), Postgres real", () => {
  const HOJE = hojeEmSaoPaulo(new Date());

  async function clienteComAviso(pedido: string, status = "em_aviso_previo"): Promise<string> {
    const [{ id }] = await query<{ id: string }>(
      `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, status_contrato, cancelamento_pedido_em, cancelamento_termino_em, contato_email)
       values ($1, 'SP', 2000, '2026-01-01', $2, $3::date, $3::date + 30, 'financeiro@prefeitura-encerrada.example.gov.br') returning id`,
      [`Prefeitura Teste Cron Aviso ${randomUUID().slice(0, 8)}`, status, pedido]
    );
    return id;
  }

  it("término ONTEM → encerrado + evento de sistema; término HOJE → continua em aviso (o dia do término ainda é de contrato); rodar de novo não duplica", async () => {
    const vencido = await clienteComAviso(somarDias(HOJE, -31));
    const hoje = await clienteComAviso(somarDias(HOJE, -30));

    const corpo = await (await POST(requisicao())).json();
    expect(corpo.contratosEncerrados).toBeGreaterThanOrEqual(1);
    expect(corpo.falhasEncerramento).toBe(0);

    const status = await query<{ id: string; status_contrato: string }>(`select id, status_contrato from cliente_prefeitura where id = any($1::uuid[])`, [[vencido, hoje]]);
    expect(Object.fromEntries(status.map((s) => [s.id, s.status_contrato]))).toEqual({ [vencido]: "encerrado", [hoje]: "em_aviso_previo" });
    const eventos = await query<{ tipo: string; data_evento: string; origem: string; equipe_id: string | null }>(
      `select tipo, data_evento, origem, equipe_id from cliente_evento_contrato where cliente_id = $1`,
      [vencido]
    );
    expect(eventos).toEqual([{ tipo: "contrato_encerrado", data_evento: somarDias(HOJE, -1), origem: "sistema", equipe_id: null }]);

    await POST(requisicao());
    expect(await query(`select 1 from cliente_evento_contrato where cliente_id = $1`, [vencido])).toHaveLength(1);
  });

  it("OBRIGATÓRIO: nota vencida de cliente ENCERRADO continua gerando alerta e e-mail de cobrança (encerrar não cancela dívida)", async () => {
    const encerrado = await clienteComAviso(somarDias(HOJE, -120), "encerrado");
    const [{ id: notaEncerrado }] = await query<{ id: string }>(
      `insert into nota_fiscal (cliente_id, competencia, valor, numero_nf, data_atesto)
       values ($1, '2026-06-01', '2000.00', 'NF-ENCERRADO-1', current_date - interval '95 days') returning id`,
      [encerrado]
    );
    vi.clearAllMocks();

    const corpo = await (await POST(requisicao())).json();
    expect(corpo.alertasCriados).toBeGreaterThanOrEqual(1);

    const alertas = await query<{ tipo: string; status: string }>(`select tipo, status from alerta_cobranca where nota_fiscal_id = $1`, [notaEncerrado]);
    expect(alertas).toEqual([{ tipo: "atraso_60_dias", status: "pendente" }]);
    const [{ status }] = await query<{ status: string }>(`select status from nota_fiscal where id = $1`, [notaEncerrado]);
    expect(status).toBe("atraso_critico");
    expect(notificarClientePrefeitura).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "atraso_60_dias", numeroNf: "NF-ENCERRADO-1", contatoEmail: "financeiro@prefeitura-encerrada.example.gov.br" })
    );
    expect(notificarTimeDeCobranca).toHaveBeenCalledWith(expect.objectContaining({ tipo: "atraso_60_dias", numeroNf: "NF-ENCERRADO-1" }));
  });
});
