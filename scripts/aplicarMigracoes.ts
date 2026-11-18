// Aplica db/migrations/*.sql em ordem alfabética, um arquivo por
// transação, registrando em _migrations — a MESMA lógica de sempre do
// `npm run migrate`, extraída de scripts/migrate.ts na rodada 15-C pra que
// o teste de concorrência (lib/equipeServico.concorrencia.integration.test.ts)
// monte um banco temporário com EXATAMENTE as migrations reais, sem copiar
// código. Recebe um Client "pg" já conectado (quem chama decide o banco).
// Mora em scripts/ (não em lib/) de propósito: é ferramenta de
// infraestrutura, e a regra de lint do projeto só deixa lib/db.ts falar
// direto com o driver "pg" dentro de app/ e lib/.
// Falha numa migration: desfaz só aquele arquivo e LANÇA (nada marcado como
// aplicado).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";

export const PASTA_MIGRACOES = join(__dirname, "..", "db", "migrations");

export interface ResultadoMigracoes {
  aplicadas: string[];
  jaAplicadas: string[];
}

export async function aplicarMigracoes(client: Client, log: (linha: string) => void = () => undefined): Promise<ResultadoMigracoes> {
  await client.query(`
    create table if not exists _migrations (
      nome text primary key,
      aplicada_em timestamptz not null default now()
    )
  `);

  const { rows } = await client.query<{ nome: string }>("select nome from _migrations");
  const registradas = new Set(rows.map((r) => r.nome));
  const resultado: ResultadoMigracoes = { aplicadas: [], jaAplicadas: [] };

  for (const arquivo of readdirSync(PASTA_MIGRACOES).filter((f) => f.endsWith(".sql")).sort()) {
    if (registradas.has(arquivo)) {
      log(`↷ ${arquivo} (já aplicada)`);
      resultado.jaAplicadas.push(arquivo);
      continue;
    }
    log(`→ aplicando ${arquivo}...`);
    try {
      await client.query("begin");
      await client.query(readFileSync(join(PASTA_MIGRACOES, arquivo), "utf-8"));
      await client.query("insert into _migrations (nome) values ($1)", [arquivo]);
      await client.query("commit");
    } catch (erro) {
      await client.query("rollback");
      throw new Error(`Migration ${arquivo} falhou — nada dela foi aplicado.`, { cause: erro });
    }
    log(`✓ ${arquivo}`);
    resultado.aplicadas.push(arquivo);
  }
  return resultado;
}
