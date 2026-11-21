// Concorrência REAL na mudança de papel (rodada 15-C — pendência da 15-A):
// dois admins se rebaixando ao MESMO TEMPO, em DUAS conexões, nunca podem
// deixar o sistema sem admin. Exatamente um rebaixamento passa; o outro
// recebe "último admin" (o que a rota traduz em 409).
//
// Por que um BANCO TEMPORÁRIO: o cenário exige que só existam 2 admins
// ativos e que as mudanças sejam de fato COMMITADAS por conexões
// diferentes — impossível numa transação desfeita, e inaceitável nas contas
// reais do banco local. Então o teste cria um banco novo com nome único
// (testes/bancoTemporario.ts: CREATE DATABASE + as MESMAS migrations do
// projeto), roda e DERRUBA o banco no fim (DROP DATABASE ... WITH
// (FORCE)), mesmo se algo falhar. Só roda com DATABASE_URL local
// (localhost/127.0.0.1/::1) — nunca cria banco num servidor remoto.
//
// O que garante o resultado é o `for update` na leitura dos admins em
// lib/equipeServico.ts: a segunda transação espera a primeira e, quando
// relê, o admin rebaixado não conta mais. Sem a trava, as duas leem "2
// admins" e as duas rebaixam — zero admins (provado removendo a trava de
// propósito: o teste falha).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { bancoLocal, criarBancoTemporario, encerrarBancoTemporario, ouvirErroDeConexao, type BancoTemporario } from "@/testes/bancoTemporario";
import { alterarPapel, type ResultadoAlterarPapel } from "./equipeServico";
import type { Executor } from "./db";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const BANCO_LOCAL = bancoLocal();
const RODADAS = 20;

describe.skipIf(!BANCO_LOCAL)("dois admins se rebaixando ao mesmo tempo — banco temporário isolado", () => {
  const admin = ouvirErroDeConexao(new Client({ connectionString: process.env.DATABASE_URL }), "admin do teste");
  let banco: BancoTemporario | null = null;
  let conexoes: Client[] = [];
  let adminA: string;
  let adminB: string;

  beforeAll(async () => {
    await admin.connect();
    banco = await criarBancoTemporario("concorrencia"); // TODAS as migrations do projeto, num banco novo
    conexoes = [0, 1, 2].map((i) => ouvirErroDeConexao(new Client({ connectionString: banco!.url }), `conexão ${i}`));
    await Promise.all(conexoes.map((c) => c.connect()));
    const { rows } = await conexoes[0].query<{ id: string }>(
      `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria, papel)
       values ('Admin A', 'a@teste.invalid', 'x', false, 'admin'), ('Admin B', 'b@teste.invalid', 'x', false, 'admin')
       returning id`
    );
    [adminA, adminB] = rows.map((r) => r.id);
  }, 60_000);

  afterAll(async () => {
    // Ordem (16-A4): as 3 conexões do banco temporário fecham ANTES do drop (o helper fecha e confere); o admin é do banco compartilhado.
    await encerrarBancoTemporario(banco, ...conexoes);
    await admin.end();
  }, 60_000);

  /** Uma transação inteira numa conexão: begin → alterarPapel → commit. */
  async function rebaixar(conexao: Client, alvo: string): Promise<ResultadoAlterarPapel> {
    await conexao.query("begin");
    try {
      const r = await alterarPapel(alvo, "financeiro", conexao as unknown as Executor);
      await conexao.query("commit");
      return r;
    } catch (erro) {
      await conexao.query("rollback");
      throw erro;
    }
  }

  it(`${RODADAS} rodadas: sempre exatamente UM rebaixamento passa, o outro é "último admin", e sobra exatamente 1 admin`, async () => {
    const [controle, c1, c2] = conexoes;
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      await controle.query(`update equipe_nexaigen set papel = 'admin', ativo = true where id = any($1::uuid[])`, [[adminA, adminB]]);

      // A rebaixa B e B rebaixa A, disparados juntos em conexões diferentes.
      const resultados = await Promise.all([rebaixar(c1, adminB), rebaixar(c2, adminA)]);

      const passaram = resultados.filter((r) => r.ok && r.mudou);
      const recusados = resultados.filter((r) => !r.ok && r.motivo === "ultimo_admin");
      expect({ rodada, passaram: passaram.length, recusados: recusados.length }).toEqual({ rodada, passaram: 1, recusados: 1 });
      const { rows } = await controle.query<{ n: number }>(`select count(*)::int as n from equipe_nexaigen where papel = 'admin' and ativo`);
      expect({ rodada, admins: rows[0].n }).toEqual({ rodada, admins: 1 });
    }
  }, 120_000);

  it("o banco temporário é outro: as contas do banco local não foram tocadas", async () => {
    const { rows } = await admin.query<{ n: number }>(`select count(*)::int as n from equipe_nexaigen where email in ('a@teste.invalid', 'b@teste.invalid')`);
    expect(rows[0].n).toBe(0);
  });
});
