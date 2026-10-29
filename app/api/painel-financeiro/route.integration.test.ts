// Painel financeiro contra Postgres REAL: as duas queries de
// lib/painelFinanceiroRepositorio.ts + o trigger de data_limite_pagamento
// + a agregação, com valores esperados EXATOS. Os cenários de fixture
// rodam dentro de uma transação que é sempre desfeita no fim
// (`emTransacaoDesfeita`): o banco local começa "vazio" só dentro dela
// (delete em cascata de cliente_prefeitura), e nada do que já existe no
// banco de desenvolvimento é alterado de verdade.
//
// A rota em si (sessão, JSON, CSV) é testada fora da transação, contra o
// banco como ele está — ali só a forma da resposta é conferida.
//
// Nunca chama Resend nem bucket: nada aqui passa por notificação/storage.
//   docker compose up -d && npm run migrate && npm run test:integration

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { NextRequest } from "next/server";
import { query, withTransaction } from "@/lib/db";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { obterPainelFinanceiro } from "@/lib/painelFinanceiroRepositorio";
import { GET } from "./route";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

// 29/out/2026 às 12h em Brasília.
const AGORA = new Date("2026-10-29T15:00:00Z");

class Desfazer extends Error {}

/** Roda `fn` numa transação real e SEMPRE faz rollback no fim (sucesso ou falha). */
async function emTransacaoDesfeita(fn: (c: PoolClient) => Promise<void>): Promise<void> {
  try {
    await withTransaction(async (c) => {
      await fn(c);
      throw new Desfazer();
    });
  } catch (erro) {
    if (!(erro instanceof Desfazer)) throw erro;
  }
}

async function inserirCliente(c: PoolClient, nome: string, valorMensal: string, plano: string, status: string): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into cliente_prefeitura (nome, uf, plano, valor_mensal, data_inicio_contrato, status_contrato, contato_email)
     values ($1, 'PR', $2, $3, '2026-01-01', $4, 'contato@prefeitura.example') returning id`,
    [nome, plano, valorMensal, status]
  );
  return r.rows[0].id;
}

async function inserirNota(
  c: PoolClient,
  n: { clienteId: string; competencia: string; valor: string; emissao: string; atesto?: string; pagamento?: string; status: string }
) {
  // data_limite_pagamento NÃO é informada — o trigger trg_calcular_data_limite calcula (atesto + 30).
  await c.query(
    `insert into nota_fiscal (cliente_id, competencia, valor, data_emissao, data_atesto, data_pagamento, status)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [n.clienteId, n.competencia, n.valor, n.emissao, n.atesto ?? null, n.pagamento ?? null, n.status]
  );
}

describe("painel financeiro — fixtures em Postgres real, valores exatos", () => {
  it("3 clientes com notas em estados variados", async () => {
    await emTransacaoDesfeita(async (c) => {
      await c.query(`delete from cliente_prefeitura`);

      const alfa = await inserirCliente(c, "Prefeitura Alfa", "1500.50", "completo", "ativo");
      const beta = await inserirCliente(c, "Prefeitura Beta", "2499.75", "essencial", "ativo");
      const gama = await inserirCliente(c, "Prefeitura Gama", "800.00", "essencial", "suspenso");

      // Alfa: paga em out (33 dias da emissão) + uma aguardando atesto há 27 dias.
      await inserirNota(c, { clienteId: alfa, competencia: "2026-09-01", valor: "1500.50", emissao: "2026-09-05", atesto: "2026-09-10", pagamento: "2026-10-08", status: "paga" });
      await inserirNota(c, { clienteId: alfa, competencia: "2026-10-01", valor: "1500.50", emissao: "2026-10-02", status: "aguardando_atesto" });
      // Alfa: paga em 2024 — fora da janela, não pode influenciar nada.
      await inserirNota(c, { clienteId: alfa, competencia: "2024-05-01", valor: "9999.99", emissao: "2024-05-02", atesto: "2024-05-03", pagamento: "2024-06-01", status: "paga" });
      // Beta: limite 09/ago → 81 dias de atraso (crítico), status gravado ainda "vencida".
      await inserirNota(c, { clienteId: beta, competencia: "2026-07-01", valor: "2499.75", emissao: "2026-07-03", atesto: "2026-07-10", status: "vencida" });
      // Beta: limite 15/out → 14 dias de atraso (vencida), status gravado ainda "atestada".
      await inserirNota(c, { clienteId: beta, competencia: "2026-09-01", valor: "2499.75", emissao: "2026-09-03", atesto: "2026-09-15", status: "atestada" });
      // Beta: paga em jul, 30 dias da emissão.
      await inserirNota(c, { clienteId: beta, competencia: "2026-06-01", valor: "2499.75", emissao: "2026-06-02", atesto: "2026-06-10", pagamento: "2026-07-02", status: "paga" });
      // Gama: cancelada — ignorada em tudo.
      await inserirNota(c, { clienteId: gama, competencia: "2026-08-01", valor: "800.00", emissao: "2026-08-02", status: "cancelada" });

      const p = await obterPainelFinanceiro(AGORA, c);

      expect(p.hoje).toBe("2026-10-29");
      expect(p.inicioJanela).toBe("2025-11-01");
      expect(p.semNotas).toBe(false);
      expect(p.kpis.mrr).toEqual({ valorCentavos: 400025, contratos: { ativos: 2, suspensos: 1, encerrados: 0 } });
      expect(p.kpis.recebidoMesCentavos).toBe(150050);
      expect(p.kpis.aReceber).toEqual({ totalCentavos: 650000, noPrazoCentavos: 150050, vencidasCentavos: 249975, atrasoCriticoCentavos: 249975 });
      // 4999,50 vencido / 10500,25 faturado na janela = 47,61% → 47,6
      expect(p.kpis.inadimplencia).toEqual({ percentual: 47.6, vencidoCentavos: 499950, faturadoCentavos: 1050025 });
      // (33 + 30) / 2
      expect(p.kpis.prazoMedioRecebimentoDias).toBe(31.5);
      expect(p.kpis.aguardandoAtestoMais15Dias).toBe(1);

      const porMes = Object.fromEntries(p.serie.map((s) => [s.mes, [s.faturadoCentavos, s.recebidoCentavos]]));
      expect(p.serie).toHaveLength(12);
      expect(porMes).toEqual({
        "2025-11": [0, 0], "2025-12": [0, 0], "2026-01": [0, 0], "2026-02": [0, 0], "2026-03": [0, 0],
        "2026-04": [0, 0], "2026-05": [0, 0],
        "2026-06": [249975, 0],
        "2026-07": [249975, 249975],
        "2026-08": [0, 0],
        "2026-09": [400025, 0],
        "2026-10": [150050, 150050]
      });

      expect(p.clientes.map((x) => [x.nome, x.notasEmAberto, x.valorEmAbertoCentavos, x.maiorAtrasoDias, x.situacao])).toEqual([
        ["Prefeitura Beta", 2, 499950, 81, "inadimplente"],
        ["Prefeitura Alfa", 1, 150050, 0, "em_dia"],
        ["Prefeitura Gama", 0, 0, 0, "em_dia"]
      ]);
      // Nenhum dado de contato sai do repositório.
      expect(JSON.stringify(p)).not.toContain("contato@prefeitura.example");
    });
  });

  it("banco vazio → estado vazio sem erro (KPIs null, série zerada, nenhum cliente)", async () => {
    await emTransacaoDesfeita(async (c) => {
      await c.query(`delete from cliente_prefeitura`);
      const p = await obterPainelFinanceiro(AGORA, c);

      expect(p.semNotas).toBe(true);
      expect(p.kpis.mrr.valorCentavos).toBeNull();
      expect(p.kpis.recebidoMesCentavos).toBeNull();
      expect(p.kpis.aReceber).toBeNull();
      expect(p.kpis.inadimplencia.percentual).toBeNull();
      expect(p.kpis.prazoMedioRecebimentoDias).toBeNull();
      expect(p.kpis.aguardandoAtestoMais15Dias).toBeNull();
      expect(p.serie.every((s) => s.faturadoCentavos === 0 && s.recebidoCentavos === 0)).toBe(true);
      expect(p.clientes).toEqual([]);
    });
  });
});

describe("GET /api/painel-financeiro — rota real", () => {
  let equipeId: string;
  let cookie: string;

  beforeAll(async () => {
    const r = await query<{ id: string; token_version: number }>(
      `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria)
       values ('Teste Painel', $1, 'hash-irrelevante-para-este-teste', false)
       returning id, token_version`,
      [`painel-${randomUUID()}@teste.nexaigen.invalid`]
    );
    equipeId = r[0].id;
    const token = await gerarAccessToken({ equipeId, nome: "Teste Painel", precisaTrocarSenha: false, tokenVersion: r[0].token_version });
    cookie = `${NOME_COOKIE_ACCESS}=${token}`;
  });

  afterAll(async () => {
    await query(`delete from equipe_nexaigen where id = $1`, [equipeId]);
  });

  it("sem sessão → 401", async () => {
    const res = await GET(new NextRequest("http://localhost:3001/api/painel-financeiro"));
    expect(res.status).toBe(401);
    const csv = await GET(new NextRequest("http://localhost:3001/api/painel-financeiro?formato=csv"));
    expect(csv.status).toBe(401);
  });

  it("com sessão → 200 JSON com KPIs, série de 12 meses e clientes", async () => {
    const res = await GET(new NextRequest("http://localhost:3001/api/painel-financeiro", { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const corpo = await res.json();
    expect(Object.keys(corpo.kpis).sort()).toEqual(
      ["aReceber", "aguardandoAtestoMais15Dias", "inadimplencia", "mrr", "prazoMedioRecebimentoDias", "recebidoMesCentavos"].sort()
    );
    expect(corpo.serie).toHaveLength(12);
    expect(Array.isArray(corpo.clientes)).toBe(true);
  });

  it("com sessão e ?formato=csv → download CSV com BOM e separador ;", async () => {
    const res = await GET(new NextRequest("http://localhost:3001/api/painel-financeiro?formato=csv", { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="painel-clientes-\d{4}-\d{2}-\d{2}\.csv"$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const texto = new TextDecoder().decode(bytes.slice(3));
    expect(texto.split("\r\n")[0]).toBe("Cliente;UF;Plano;Valor mensal (R$);Notas em aberto;Valor em aberto (R$);Maior atraso (dias);Situação");
  });
});
