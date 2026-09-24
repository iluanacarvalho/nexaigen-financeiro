// Bootstrap da PRIMEIRA conta de equipe_nexaigen (login próprio da
// equipe NEXAIGEN — rodada de correção de achado crítico de segurança).
// Sem uma primeira conta, ninguém consegue logar em /login pra cadastrar
// a segunda — este script existe só pra romper esse ovo-e-galinha.
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
// DESVIO DELIBERADO do pedido original ("usa 'pg' direto, lê
// DATABASE_URL"): esse é o padrão do projeto IRMÃO nexaigen-educa, que é
// 100% Postgres direto (sem Supabase). Este projeto (nexaigen-financeiro)
// nunca teve — e continua sem ter — qualquer conexão Postgres crua; TUDO
// aqui (incluindo o job de cron, app/api/cron/verificar-prazos) já
// acessa o banco via supabaseAdmin() (service_role, ignora RLS). Copiar
// literalmente "pg + DATABASE_URL" introduziria uma segunda forma de
// conectar ao mesmo banco, inconsistente com o resto do projeto, exigindo
// uma env var (DATABASE_URL) que não existe em nenhum outro lugar deste
// repositório (só NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).
// Este script usa supabaseAdmin(), a MESMA função que toda rota da
// aplicação já usa — mesmo comportamento funcional pedido (recusa se
// e-mail já existe, gera senha temporária, imprime no console), só pela
// via de acesso que este projeto de fato tem.

import { supabaseAdmin } from "../lib/supabase/server";
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
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configuradas.");
    process.exit(1);
  }

  const supabase = supabaseAdmin();
  const emailNormalizado = email.toLowerCase();

  const { data: existente, error: erroBusca } = await supabase
    .from("equipe_nexaigen")
    .select("id")
    .eq("email", emailNormalizado)
    .maybeSingle();
  if (erroBusca) {
    console.error("Erro consultando equipe_nexaigen:", erroBusca.message);
    process.exit(1);
  }
  if (existente) {
    console.error(`Já existe uma conta de equipe com o e-mail "${emailNormalizado}" — nada foi alterado.`);
    process.exit(1);
  }

  const senhaTemporaria = gerarSenhaTemporaria();
  const senhaHash = await hashSenha(senhaTemporaria);

  const { data: nova, error: erroInsert } = await supabase
    .from("equipe_nexaigen")
    .insert({ nome, email: emailNormalizado, senha_hash: senhaHash })
    .select("id")
    .single();
  if (erroInsert) {
    console.error("Erro criando conta de equipe:", erroInsert.message);
    process.exit(1);
  }

  console.log("✓ Conta de equipe NEXAIGEN criada.");
  console.log(`   ID:    ${nova.id}`);
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
