// Bootstrap da PRIMEIRA conta de equipe_nexaigen. Sem uma primeira conta,
// ninguém consegue logar em /login pra cadastrar a segunda — este script
// existe só pra romper esse ovo-e-galinha.
//
// USO: rodado UMA VEZ, manualmente, pela Luana, direto no terminal:
//
//   NOME="Luana Carvalho" EMAIL="luana@nexaigen.com.br" \
//     npx tsx --env-file-if-exists=.env --env-file-if-exists=.env.local \
//     scripts/bootstrap-equipe-nexaigen.ts
//
// Depois desta primeira conta existir, TODA conta nova vem da tela
// /equipe (POST /api/equipe, exige sessão já logada) — nunca mais
// rodando este script de novo pra gente nova.
//
// RODADA DE MIGRAÇÃO DE INFRAESTRUTURA: reescrito pra usar Postgres
// direto (lê DATABASE_URL) — na rodada anterior (login próprio) este
// script usava supabaseAdmin() porque era a única forma de acesso a
// banco que o projeto tinha; agora que existe lib/db.ts (mesmo padrão do
// nexaigen-educa), reaproveita `query()` de lá em vez de abrir uma
// conexão "pg" própria e separada — mesmo raciocínio de
// scripts/seed.ts do nexaigen-educa, que reaproveita as funções de
// acesso a dado já existentes do projeto sempre que existem, só abrindo
// uma conexão "pg" crua pra operações sem função própria (não é o caso
// aqui: ler/escrever equipe_nexaigen já tem `query()`).

import { query } from "../lib/db";
import { gerarSenhaTemporaria, hashSenha } from "../lib/auth";

async function main() {
  const nome = process.env.NOME?.trim();
  const email = process.env.EMAIL?.trim();

  if (!nome || nome.length < 2) {
    console.error('Informe NOME (mínimo 2 caracteres) — ex.: NOME="Luana Carvalho" EMAIL="luana@nexaigen.com.br" npx tsx ...');
    process.exit(1);
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Informe EMAIL válido — ex.: NOME="Luana Carvalho" EMAIL="luana@nexaigen.com.br" npx tsx ...');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL não configurada.");
    process.exit(1);
  }

  const emailNormalizado = email.toLowerCase();

  const existentes = await query<{ id: string }>(`select id from equipe_nexaigen where email = $1`, [emailNormalizado]);
  if (existentes.length > 0) {
    console.error(`Já existe uma conta de equipe com o e-mail "${emailNormalizado}" — nada foi alterado.`);
    process.exit(1);
  }

  const senhaTemporaria = gerarSenhaTemporaria();
  const senhaHash = await hashSenha(senhaTemporaria);

  const linhas = await query<{ id: string }>(
    `insert into equipe_nexaigen (nome, email, senha_hash) values ($1, $2, $3) returning id`,
    [nome, emailNormalizado, senhaHash]
  );

  console.log("✓ Conta de equipe NEXAIGEN criada.");
  console.log(`   ID:    ${linhas[0].id}`);
  console.log(`   Nome:  ${nome}`);
  console.log(`   E-mail: ${emailNormalizado}`);
  console.log(`   Senha temporária: ${senhaTemporaria}`);
  console.log("\n⚠️  Guarde esta senha — ela não será mostrada de novo. Login em /login,");
  console.log("   com troca de senha exigida no primeiro acesso.");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
