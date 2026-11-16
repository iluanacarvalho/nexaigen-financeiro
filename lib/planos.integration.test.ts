// Migration 0010 (planos por porte) contra Postgres REAL, dentro de uma
// transação SEMPRE desfeita: recria o estado "pré-0010" (CHECK antigo +
// cliente 'essencial'/'completo'), aplica a 0010 DUAS vezes e confere:
// conversão pra 'dispensa' mantendo valor_mensal, CHECK novo recusando
// 'essencial', Dispensa nunca com taxa, tipo da nota, e no máximo UMA nota
// de implantação ativa por cliente.

import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withTransaction } from "./db";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const SQL_0010 = readFileSync(join(process.cwd(), "db/migrations/0010_planos_por_porte.sql"), "utf-8");
class Desfazer extends Error {}

async function emTransacaoDesfeita(fn: Parameters<typeof withTransaction>[0]) {
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
async function esperarViolacao(c: Parameters<Parameters<typeof withTransaction>[0]>[0], sql: string, params: unknown[], constraint: string) {
  await c.query("savepoint tentativa");
  await expect(c.query(sql, params)).rejects.toMatchObject({ constraint });
  await c.query("rollback to savepoint tentativa");
}

describe("migration 0010 — Postgres real", () => {
  it("aplicada 2× sobre dado legado: converte 'essencial'/'completo' pra 'dispensa' MANTENDO o valor; CHECK novo recusa 'essencial'", async () => {
    await emTransacaoDesfeita(async (c) => {
      // Volta ao estado pré-0010 só nesta transação: tira os CHECKs novos, recoloca um CHECK antigo (com outro nome
      // — a 0010 acha pelo catálogo, não pelo nome) e cria clientes legados.
      await c.query(`alter table cliente_prefeitura drop constraint ck_cliente_prefeitura_plano`);
      await c.query(`alter table cliente_prefeitura drop constraint ck_cliente_prefeitura_dispensa_sem_taxa`);
      await c.query(`alter table cliente_prefeitura add constraint qualquer_nome_legado check (plano in ('essencial', 'completo', 'dispensa', 'pequeno_porte', 'medio_porte', 'grande_porte'))`);
      const s = randomUUID().slice(0, 8);
      const { rows } = await c.query<{ id: string }>(
        `insert into cliente_prefeitura (nome, uf, plano, valor_mensal, data_inicio_contrato)
         values ($1, 'PR', 'essencial', 1234.56, current_date), ($2, 'PR', 'completo', 9876.54, current_date) returning id`,
        [`Legado A ${s}`, `Legado B ${s}`]
      );

      await c.query(SQL_0010);
      await c.query(SQL_0010); // idempotente

      const { rows: convertidos } = await c.query(`select plano, valor_mensal, taxa_implantacao from cliente_prefeitura where id = any($1::uuid[]) order by valor_mensal`, [rows.map((r) => r.id)]);
      expect(convertidos).toEqual([
        { plano: "dispensa", valor_mensal: "1234.56", taxa_implantacao: null },
        { plano: "dispensa", valor_mensal: "9876.54", taxa_implantacao: null }
      ]);
      const { rows: checks } = await c.query(`select conname from pg_constraint where conrelid = 'cliente_prefeitura'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'essencial'`);
      expect(checks).toEqual([]); // o CHECK antigo (achado pelo catálogo) sumiu

      await esperarViolacao(c, `update cliente_prefeitura set plano = 'essencial' where id = $1`, [rows[0].id], "ck_cliente_prefeitura_plano");
    });
  });

  it("Dispensa nunca tem taxa; taxa precisa ser positiva; default do plano é 'dispensa'", async () => {
    await emTransacaoDesfeita(async (c) => {
      const { rows } = await c.query<{ id: string; plano: string }>(
        `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato) values ('Sem plano informado', 'PR', 100, current_date) returning id, plano`
      );
      expect(rows[0].plano).toBe("dispensa");
      await esperarViolacao(c, `update cliente_prefeitura set taxa_implantacao = 100 where id = $1`, [rows[0].id], "ck_cliente_prefeitura_dispensa_sem_taxa");
      await c.query(`update cliente_prefeitura set plano = 'pequeno_porte', taxa_implantacao = 15000 where id = $1`, [rows[0].id]);
      await esperarViolacao(c, `update cliente_prefeitura set taxa_implantacao = 0 where id = $1`, [rows[0].id], "ck_cliente_prefeitura_taxa_implantacao_positiva");
    });
  });

  it("nota: tipo padrão 'mensalidade', tipo inválido recusado, no máximo UMA implantação não cancelada por cliente", async () => {
    await emTransacaoDesfeita(async (c) => {
      const { rows: [cliente] } = await c.query<{ id: string }>(
        `insert into cliente_prefeitura (nome, uf, plano, valor_mensal, taxa_implantacao, data_inicio_contrato) values ('Porte', 'PR', 'medio_porte', 15000, 20000, current_date) returning id`
      );
      const { rows: [mensal] } = await c.query<{ tipo: string }>(`insert into nota_fiscal (cliente_id, competencia, valor) values ($1, current_date, 1) returning tipo`, [cliente.id]);
      expect(mensal.tipo).toBe("mensalidade");
      await esperarViolacao(c, `insert into nota_fiscal (cliente_id, competencia, valor, tipo) values ($1, current_date, 1, 'multa')`, [cliente.id], "ck_nota_fiscal_tipo");

      const { rows: [imp] } = await c.query<{ id: string }>(`insert into nota_fiscal (cliente_id, competencia, valor, tipo) values ($1, current_date, 20000, 'implantacao') returning id`, [cliente.id]);
      await esperarViolacao(c, `insert into nota_fiscal (cliente_id, competencia, valor, tipo) values ($1, current_date, 20000, 'implantacao')`, [cliente.id], "uq_nota_fiscal_implantacao_ativa");
      // Cancelada não conta: dá pra emitir de novo.
      await c.query(`update nota_fiscal set status = 'cancelada' where id = $1`, [imp.id]);
      await c.query(`insert into nota_fiscal (cliente_id, competencia, valor, tipo) values ($1, current_date, 20000, 'implantacao')`, [cliente.id]);
    });
  });
});
