// lib/validacao.ts#ehUuid (zod 4, RFC 9562/4122) contra ids REAIS do
// Postgres: todo id do sistema nasce de gen_random_uuid() (e o município
// que chega do nexaigen-educa também — `municipio.id ... default
// gen_random_uuid()` lá). Prova que o uuid mais rígido do zod 4 não recusa
// nenhum id legítimo.

import { describe, expect, it } from "vitest";
import { query } from "./db";
import { ehUuid } from "./validacao";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

describe("ehUuid × ids gerados pelo Postgres", () => {
  it("1000 gen_random_uuid() — todos válidos", async () => {
    const linhas = await query<{ id: string }>(`select gen_random_uuid()::text as id from generate_series(1, 1000)`);
    expect(linhas).toHaveLength(1000);
    expect(linhas.filter((l) => !ehUuid(l.id))).toEqual([]);
  });

  it("ids já existentes nas tabelas do sistema — todos válidos", async () => {
    const linhas = await query<{ id: string }>(
      `select id::text from cliente_prefeitura union all select id::text from nota_fiscal
       union all select id::text from equipe_nexaigen union all select municipio_id_externo::text from cliente_prefeitura where municipio_id_externo is not null`
    );
    expect(linhas.filter((l) => !ehUuid(l.id))).toEqual([]);
  });
});
