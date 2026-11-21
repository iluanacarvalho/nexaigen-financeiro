// Aplica db/migrations/*.sql em ordem alfabética, um arquivo por
// transação — mesmo padrão de scripts/migrate.ts do projeto irmão
// nexaigen-educa (rodada de migração de infraestrutura Supabase → pg
// direto). Script de infraestrutura — roda fora do request/response, por
// isso usa "pg" diretamente em vez de lib/db.ts (mesma justificativa de
// scripts/** no nexaigen-educa: tooling de deploy/CI, não código de
// runtime do app).

import { Client } from "pg";
import { aplicarMigracoes, ehBancoDeDesenvolvimento } from "./aplicarMigracoes";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL não configurada.");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  // Conexão derrubada pelo servidor (reinício, failover) emite "error": sem listener o Node lança uma exceção
  // solta. Com ele, a migration em andamento falha pela própria consulta (rollback do arquivo) — rodada 16-A4.
  client.on("error", (erro: Error & { code?: string }) => console.error(`✗ conexão com o banco caiu (${erro.code ?? "sem código"}): ${erro.message.slice(0, 200)}`));
  await client.connect();
  try {
    // A lógica (um arquivo por transação, registro em _migrations) mora em scripts/aplicarMigracoes.ts desde a rodada 15-C.
    // Seeds de desenvolvimento (ex.: PR liberado no Território, 0016) só em banco local — em produção a liberação é ato do admin.
    await aplicarMigracoes(client, (linha) => console.log(linha), { desenvolvimento: ehBancoDeDesenvolvimento(databaseUrl) });
    console.log("Migrações em dia.");
  } catch (erro) {
    console.error("✗ parando sem marcar a migration que falhou como aplicada.");
    console.error(erro);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
