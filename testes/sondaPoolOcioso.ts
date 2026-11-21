// SONDA de teste (rodada 16-A4) — rodada como PROCESSO FILHO por
// lib/db.pool.integration.test.ts. Usa o pool REAL da aplicação (lib/db.ts):
//   1) uma consulta → o cliente volta OCIOSO pro pool (guarda o pid dele);
//   2) de OUTRA conexão, o servidor derruba esse pid (pg_terminate_backend →
//      "terminating connection due to administrator command", 57P01);
//   3) espera o pool perceber (o cliente ocioso emite "error" e é descartado);
//   4) consulta de novo — tem de funcionar, num cliente NOVO.
// Sem o listener de "error" do pool, o passo 3 derruba ESTE processo
// (exceção não capturada) — o teste confere o código de saída.
// Imprime só pids e contagens (nunca a URL do banco).

import { Client } from "pg";
import { query } from "../lib/db";

async function main() {
  const pool = (globalThis as { __nexaigenFinPgPool?: { totalCount: number; idleCount: number; end: () => Promise<void> } }).__nexaigenFinPgPool!;
  const [{ pid }] = await query<{ pid: number }>("select pg_backend_pid() as pid");
  const antes = { total: pool.totalCount, ociosos: pool.idleCount };

  const outra = new Client({ connectionString: process.env.DATABASE_URL, application_name: "teste:sonda-pool-derrubador" });
  outra.on("error", () => undefined);
  await outra.connect();
  const [{ derrubou }] = (await outra.query<{ derrubou: boolean }>("select pg_terminate_backend($1) as derrubou", [pid])).rows;
  await outra.end();

  for (let i = 0; i < 50 && pool.totalCount > 0; i++) await new Promise((r) => setTimeout(r, 100)); // o pool descarta o cliente morto
  const descartado = pool.totalCount === 0;

  const [{ novoPid }] = await query<{ novoPid: number }>(`select pg_backend_pid() as "novoPid"`);
  console.log(JSON.stringify({ antes, derrubou, descartado, consultaSeguinte: "ok", mesmoPid: novoPid === pid }));
  await pool.end();
}

main().catch((erro: Error) => {
  console.error(`SONDA FALHOU: ${erro.message}`);
  process.exitCode = 2;
});
