// Setup GLOBAL da suíte de integração (rodada 16-A3) — roda UMA vez, no
// processo principal, antes de todos os arquivos.
//
// UMA EXECUÇÃO POR BANCO: os testes que usam o banco compartilhado criam e
// apagam os próprios dados, mas duas execuções AO MESMO TEMPO no mesmo banco
// se atrapalham (o cron de uma "vê" as notas da outra — medido: 3 e 4 falhas
// com duas suítes em paralelo). Esta trava (advisory lock de sessão no
// Postgres, segurada até o fim da suíte) faz a SEGUNDA execução falhar na
// hora, com mensagem clara, em vez de quebrar de jeito intermitente.
// A trava é do servidor Postgres apontado por DATABASE_URL; nenhum valor de
// ambiente é impresso.

import { Client } from "pg";

const CHAVE = "nexaigen-financeiro:test:integration";

export default async function setup(): Promise<() => Promise<void>> {
  if (!process.env.DATABASE_URL) return async () => undefined; // os arquivos já explicam a falta de DATABASE_URL
  const conexao = new Client({ connectionString: process.env.DATABASE_URL, application_name: "teste:trava-da-suite" });
  await conexao.connect();
  const [{ obtida }] = (await conexao.query<{ obtida: boolean }>("select pg_try_advisory_lock(hashtext($1)) as obtida", [CHAVE])).rows;
  if (!obtida) {
    await conexao.end();
    throw new Error(
      "Outra execução de `npm run test:integration` está usando este mesmo banco AGORA. Duas suítes simultâneas no banco compartilhado se atrapalham — espere a outra terminar e rode de novo."
    );
  }
  return async () => {
    await conexao.query("select pg_advisory_unlock(hashtext($1))", [CHAVE]).catch(() => undefined);
    await conexao.end();
  };
}
