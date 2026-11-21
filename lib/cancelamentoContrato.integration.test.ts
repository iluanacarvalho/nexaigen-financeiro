// Migration 0011 (cancelamento de contrato) contra Postgres REAL, dentro
// de uma transação SEMPRE desfeita: recria o estado "pré-0011" (CHECK
// antigo de status_contrato com o nome que o Postgres deu na 0001, sem
// 'em_aviso_previo'), aplica a 0011 DUAS vezes e confere: o CHECK antigo
// (achado pelo catálogo, não pelo nome) sumiu, 'em_aviso_previo' passa a
// valer só com pedido e término coerentes, o motivo tem limite, e a trilha
// de auditoria aceita só os tipos/origens previstos e some junto com o
// cliente (cascade).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { query, withTransaction } from "./db";
import { confirmarBancoTemporario, encerrarBancoTemporario } from "@/testes/bancoTemporario";

// Este arquivo faz DDL (migration aplicada sobre estado antigo) → roda INTEIRO num banco TEMPORÁRIO (rodada 16-A3),
// nunca no compartilhado: o DDL pega trava exclusiva e ficava esperando outras conexões. vi.hoisted roda antes dos imports.
const banco = await vi.hoisted(async () => (await import("@/testes/bancoTemporario")).trocarParaBancoTemporario("cancelamento"));
beforeAll(() => confirmarBancoTemporario(banco, (sql) => query(sql)));
afterAll(() => encerrarBancoTemporario(banco));

const SQL_0011 = readFileSync(join(process.cwd(), "db/migrations/0011_cancelamento_contrato.sql"), "utf-8");
class Desfazer extends Error {}
type Cliente = Parameters<Parameters<typeof withTransaction>[0]>[0];

async function emTransacaoDesfeita(fn: (c: Cliente) => Promise<void>) {
  try {
    await withTransaction(async (c) => {
      await fn(c);
      throw new Desfazer();
    });
  } catch (erro) {
    if (!(erro instanceof Desfazer)) throw erro;
  }
}

/** Espera que `sql` falhe com a constraint dada — num savepoint, pra transação continuar utilizável. */
async function esperarViolacao(c: Cliente, sql: string, params: unknown[], constraint: string) {
  await c.query("savepoint tentativa");
  await expect(c.query(sql, params)).rejects.toMatchObject({ constraint });
  await c.query("rollback to savepoint tentativa");
}

async function novoCliente(c: Cliente): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato) values ('Migração 0011', 'PR', 100, '2026-01-01') returning id`
  );
  return rows[0].id;
}

describe.skipIf(!banco)("migration 0011 — Postgres real (banco temporário)", () => {
  it("aplicada 2× sobre o estado pré-0011: troca o CHECK antigo (achado pelo catálogo) e não duplica nada", async () => {
    await emTransacaoDesfeita(async (c) => {
      await c.query(`alter table cliente_prefeitura drop constraint ck_cliente_prefeitura_status_contrato`);
      await c.query(`alter table cliente_prefeitura drop constraint ck_cliente_prefeitura_aviso_previo`);
      await c.query(`alter table cliente_prefeitura add constraint cliente_prefeitura_status_contrato_check check (status_contrato in ('ativo', 'suspenso', 'encerrado'))`);

      await c.query(SQL_0011);
      await c.query(SQL_0011); // idempotente

      const { rows } = await c.query<{ conname: string }>(
        `select conname from pg_constraint where conrelid = 'cliente_prefeitura'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'status_contrato' order by conname`
      );
      expect(rows.map((r) => r.conname)).toEqual(["ck_cliente_prefeitura_aviso_previo", "ck_cliente_prefeitura_status_contrato"]);
      const { rows: indices } = await c.query<{ indexname: string }>(
        `select indexname from pg_indexes where indexname in ('idx_cliente_prefeitura_aviso_previo', 'idx_cliente_evento_contrato_cliente') order by indexname`
      );
      expect(indices.map((i) => i.indexname)).toEqual(["idx_cliente_evento_contrato_cliente", "idx_cliente_prefeitura_aviso_previo"]);

      const id = await novoCliente(c);
      await esperarViolacao(c, `update cliente_prefeitura set status_contrato = 'cancelado' where id = $1`, [id], "ck_cliente_prefeitura_status_contrato");
    });
  });

  it("coerência: em aviso exige pedido e término; término = pedido + 30; pedido/término andam juntos; motivo até 500", async () => {
    await emTransacaoDesfeita(async (c) => {
      const id = await novoCliente(c);
      await esperarViolacao(c, `update cliente_prefeitura set status_contrato = 'em_aviso_previo' where id = $1`, [id], "ck_cliente_prefeitura_aviso_previo");
      await esperarViolacao(
        c,
        `update cliente_prefeitura set status_contrato = 'em_aviso_previo', cancelamento_pedido_em = '2026-10-01', cancelamento_termino_em = '2026-10-30' where id = $1`,
        [id],
        "ck_cliente_prefeitura_aviso_previo"
      );
      await esperarViolacao(c, `update cliente_prefeitura set cancelamento_pedido_em = '2026-10-01' where id = $1`, [id], "ck_cliente_prefeitura_aviso_previo");
      await esperarViolacao(c, `update cliente_prefeitura set cancelamento_motivo = repeat('x', 501) where id = $1`, [id], "ck_cliente_prefeitura_cancelamento_motivo_tamanho");

      await c.query(
        `update cliente_prefeitura set status_contrato = 'em_aviso_previo', cancelamento_pedido_em = '2026-10-01', cancelamento_termino_em = '2026-10-31', cancelamento_motivo = repeat('x', 500) where id = $1`,
        [id]
      );
      // Encerrado mantém pedido/término (é o que permite a nota final); ativo com tudo nulo também vale.
      await c.query(`update cliente_prefeitura set status_contrato = 'encerrado' where id = $1`, [id]);
      await c.query(`update cliente_prefeitura set status_contrato = 'ativo', cancelamento_pedido_em = null, cancelamento_termino_em = null, cancelamento_motivo = null where id = $1`, [id]);
    });
  });

  it("cliente_evento_contrato: só tipos/origens previstos; some com o cliente (cascade)", async () => {
    await emTransacaoDesfeita(async (c) => {
      const id = await novoCliente(c);
      const inserir = (tipo: string, origem: string) =>
        c.query(`insert into cliente_evento_contrato (cliente_id, tipo, data_evento, origem) values ($1, $2, '2026-10-01', $3)`, [id, tipo, origem]);
      for (const tipo of ["cancelamento_registrado", "cancelamento_retratado", "contrato_encerrado"]) await inserir(tipo, "painel");
      await inserir("contrato_encerrado", "educa");
      await inserir("contrato_encerrado", "sistema");

      await c.query("savepoint s1");
      await expect(inserir("contrato_apagado", "painel")).rejects.toMatchObject({ code: "23514" });
      await c.query("rollback to savepoint s1");
      await expect(inserir("contrato_encerrado", "planilha")).rejects.toMatchObject({ code: "23514" });
      await c.query("rollback to savepoint s1");

      await c.query(`delete from cliente_prefeitura where id = $1`, [id]);
      const { rows } = await c.query(`select 1 from cliente_evento_contrato where cliente_id = $1`, [id]);
      expect(rows).toEqual([]);
    });
  });
});
