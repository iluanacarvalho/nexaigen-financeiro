// Relatório de novos contratos contra Postgres REAL:
//   - fixtures (clientes em meses diferentes, encerrado e em aviso pela
//     trilha cliente_evento_contrato, implantação já emitida) numa
//     transação SEMPRE desfeita, com valores exatos — incluindo a mesma
//     base de MRR do Painel (obterPainelFinanceiro na mesma transação);
//   - rota real com sessão (financeiro): JSON, CSV e XLSX, e os números do
//     mês atual batendo com Painel e Dashboard no banco como ele está.
//   docker compose up -d && npm run migrate && npm run test:integration

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { NextRequest } from "next/server";
import { query, withTransaction } from "./db";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "./auth";
import { hojeEmSaoPaulo } from "./painelFinanceiro";
import { obterPainelFinanceiro } from "./painelFinanceiroRepositorio";
import { obterRelatorioContratos } from "./relatorioContratosRepositorio";
import { obterResumoDashboard } from "./resumoDashboard";
import { GET as RELATORIO } from "@/app/api/relatorios/novos-contratos/route";
import { GET as PAINEL } from "@/app/api/painel-financeiro/route";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

// 17/nov/2026 às 12h em Brasília.
const AGORA = new Date("2026-11-17T15:00:00Z");
class Desfazer extends Error {}

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

async function cliente(c: PoolClient, d: { nome: string; inicio: string; valor: string; plano?: string; taxa?: string; status?: string; pedido?: string; municipio?: string }): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into cliente_prefeitura (nome, uf, plano, valor_mensal, taxa_implantacao, data_inicio_contrato, status_contrato, cancelamento_pedido_em, cancelamento_termino_em, municipio_id_externo)
     values ($1, 'PR', $2, $3, $4, $5, $6, $7::date, $7::date + 30, $8) returning id`,
    [d.nome, d.plano ?? "dispensa", d.valor, d.taxa ?? null, d.inicio, d.status ?? "ativo", d.pedido ?? null, d.municipio ?? null]
  );
  return rows[0].id;
}

async function evento(c: PoolClient, clienteId: string, tipo: string, data: string) {
  await c.query(`insert into cliente_evento_contrato (cliente_id, tipo, data_evento, origem) values ($1, $2, $3, 'painel')`, [clienteId, tipo, data]);
}

describe("relatório de novos contratos — fixtures em Postgres real, valores exatos", () => {
  it("novos de nov, out, set; encerrado em nov; em aviso; implantação já emitida; MRR igual ao do Painel", async () => {
    await emTransacaoDesfeita(async (c) => {
      await c.query(`delete from cliente_prefeitura`); // só dentro desta transação (desfeita no fim)

      const beta = await cliente(c, { nome: "Beta", inicio: "2026-11-10", valor: "8500.00", plano: "pequeno_porte", taxa: "15000.00", municipio: randomUUID() });
      await cliente(c, { nome: "Alfa", inicio: "2026-11-01", valor: "5457.00" });
      const gama = await cliente(c, { nome: "Gama", inicio: "2026-11-30", valor: "15000.00", plano: "medio_porte", taxa: "20000.00" });
      await c.query(`insert into nota_fiscal (cliente_id, competencia, valor, tipo) values ($1, '2026-11-01', 20000, 'implantacao')`, [gama]);
      await cliente(c, { nome: "Outubro", inicio: "2026-10-31", valor: "3000.00" });
      await cliente(c, { nome: "Setembro", inicio: "2026-09-01", valor: "1000.00" });
      const saiu = await cliente(c, { nome: "Saiu", inicio: "2025-03-01", valor: "999.99", status: "encerrado", pedido: "2026-10-05" });
      await evento(c, saiu, "cancelamento_registrado", "2026-10-05");
      await evento(c, saiu, "contrato_encerrado", "2026-11-04");
      const aviso = await cliente(c, { nome: "Aviso", inicio: "2025-05-01", valor: "700.00", status: "em_aviso_previo", pedido: "2026-11-10" });
      await evento(c, aviso, "cancelamento_registrado", "2026-11-10");

      const r = await obterRelatorioContratos("2026-11", AGORA, c);
      expect(r.hoje).toBe("2026-11-17");
      expect(r.novos).toEqual({ quantidade: 3, mrrCentavos: 2895700, implantacaoACobrarCentavos: 1500000 });
      expect(r.anterior).toEqual({ quantidade: 1, mrrCentavos: 300000 });
      expect(r.variacao.quantidade).toEqual({ absoluta: 2, percentual: 200 });
      expect(r.encerrados).toEqual({ quantidade: 1, mrrCentavos: 99999 });
      expect(r.emAvisoPrevio).toEqual({ quantidade: 1, mrrCentavos: 70000 });
      expect(r.saldoLiquido).toEqual({ quantidade: 2, mrrCentavos: 2795701 });
      expect(r.contratos.map((x) => [x.nome, x.dataInicio, x.origem])).toEqual([
        ["Alfa", "2026-11-01", "painel"],
        ["Beta", "2026-11-10", "educa"],
        ["Gama", "2026-11-30", "painel"]
      ]);
      expect(r.contratos.find((x) => x.id === beta)).toMatchObject({ planoRotulo: "Pequeno Porte", valorMensalCentavos: 850000, taxaImplantacaoCentavos: 1500000 });
      expect(r.serie.map((p) => [p.mes, p.novos]).filter(([, n]) => n !== 0)).toEqual([["2026-09", 1], ["2026-10", 1], ["2026-11", 3]]);

      // MESMA base de MRR do Painel: ativos + em aviso (8.500 + 5.457 + 15.000 + 3.000 + 1.000 + 700).
      const painel = await obterPainelFinanceiro(AGORA, c);
      expect(r.mrrCarteiraHojeCentavos).toBe(painel.kpis.mrr.valorCentavos);
      expect(r.mrrCarteiraHojeCentavos).toBe(3365700);
      expect(r.emAvisoPrevio.quantidade).toBe(painel.kpis.avisoPrevio.quantidade);
      expect(r.emAvisoPrevio.mrrCentavos).toBe(painel.kpis.avisoPrevio.mrrEmRiscoCentavos);

      // Mês passado: aviso registrado em 10/11 não conta em outubro; o "Saiu" estava em aviso no fim de outubro.
      const outubro = await obterRelatorioContratos("2026-10", AGORA, c);
      expect(outubro.dataReferencia).toBe("2026-10-31");
      expect(outubro.emAvisoPrevio).toEqual({ quantidade: 1, mrrCentavos: 99999 });
      expect(outubro.encerrados.quantidade).toBe(0);

      const vazio = await obterRelatorioContratos("2026-08", AGORA, c);
      expect(vazio.semContratos).toBe(true);
      expect(vazio.contratos).toEqual([]);
    });
  });
});

describe("GET /api/relatorios/novos-contratos — rota real (financeiro)", () => {
  let equipeId: string;
  let cookie: string;
  const req = (q: string) => new NextRequest(`http://localhost:3001/api/relatorios/novos-contratos${q}`, { headers: { cookie } });

  beforeAll(async () => {
    const [e] = await query<{ id: string; token_version: number }>(
      `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria, papel) values ('Pessoa Relatório', $1, 'x', false, 'financeiro') returning id, token_version`,
      [`relatorio-${randomUUID().slice(0, 8)}@teste.nexaigen.invalid`]
    );
    equipeId = e.id;
    cookie = `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId, nome: "Pessoa Relatório", precisaTrocarSenha: false, tokenVersion: e.token_version })}`;
  });

  afterAll(async () => {
    await query(`delete from equipe_nexaigen where id = $1`, [equipeId]);
  });

  it("JSON do mês atual bate com Painel e Dashboard (MRR da carteira e aviso prévio) no banco como ele está", async () => {
    const [relatorio, painel, dashboard] = await Promise.all([
      RELATORIO(req("")).then((r) => r.json()),
      PAINEL(new NextRequest("http://localhost:3001/api/painel-financeiro", { headers: { cookie } })).then((r) => r.json()),
      obterResumoDashboard()
    ]);
    expect(relatorio.mes).toBe(hojeEmSaoPaulo(new Date()).slice(0, 7));
    expect(relatorio.mrrCarteiraHojeCentavos).toBe(painel.kpis.mrr.valorCentavos);
    expect(relatorio.emAvisoPrevio.quantidade).toBe(painel.kpis.avisoPrevio.quantidade);
    expect(relatorio.emAvisoPrevio.quantidade).toBe(dashboard.avisoPrevio.quantidade);
  });

  it("CSV e XLSX: download com nome do mês, tipo certo e cabeçalho do relatório", async () => {
    const csv = await RELATORIO(req("?mes=2026-10&formato=csv"));
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="novos-contratos-2026-10.csv"');
    expect(csv.headers.get("cache-control")).toBe("no-store");
    const bytesCsv = Buffer.from(await csv.arrayBuffer()); // .text() descartaria o BOM ao decodificar
    expect(bytesCsv.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    expect(bytesCsv.subarray(3).toString("utf8").startsWith("NEXAIGEN — Relatório de novos contratos\r\nMês: 10/2026\r\nGerado em: ")).toBe(true);

    const xlsx = await RELATORIO(req("?mes=2026-10&formato=xlsx"));
    expect(xlsx.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(xlsx.headers.get("content-disposition")).toBe('attachment; filename="novos-contratos-2026-10.xlsx"');
    const bytes = Buffer.from(await xlsx.arrayBuffer());
    expect(bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true); // assinatura ZIP
    expect(bytes.toString("latin1")).toContain("xl/worksheets/sheet1.xml");
  });
});
