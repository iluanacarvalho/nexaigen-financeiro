// Aplica db/migrations/*.sql em ordem alfabética, um arquivo por
// transação — mesmo padrão de scripts/migrate.ts do projeto irmão
// nexaigen-educa (rodada de migração de infraestrutura Supabase → pg
// direto). Script de infraestrutura — roda fora do request/response, por
// isso usa "pg" diretamente em vez de lib/db.ts (mesma justificativa de
// scripts/** no nexaigen-educa: tooling de deploy/CI, não código de
// runtime do app).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL não configurada.");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      create table if not exists _migrations (
        nome text primary key,
        aplicada_em timestamptz not null default now()
      )
    `);

    const { rows: aplicadas } = await client.query<{ nome: string }>("select nome from _migrations");
    const jaAplicadas = new Set(aplicadas.map((r) => r.nome));

    const arquivos = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const arquivo of arquivos) {
      if (jaAplicadas.has(arquivo)) {
        console.log(`↷ ${arquivo} (já aplicada)`);
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, arquivo), "utf-8");
      console.log(`→ aplicando ${arquivo}...`);

      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into _migrations (nome) values ($1)", [arquivo]);
        await client.query("commit");
        console.log(`✓ ${arquivo}`);
      } catch (erro) {
        await client.query("rollback");
        console.error(`✗ ${arquivo} falhou — parando sem marcar como aplicada.`);
        console.error(erro);
        process.exit(1);
      }
    }

    console.log("Migrações em dia.");
  } finally {
    await client.end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
