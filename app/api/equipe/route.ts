// Gestão da própria equipe NEXAIGEN — GET lista colegas, POST cadastra um
// colega novo. Desde a rodada 15-A SÓ ADMIN (exigirPapel área "equipe",
// lib/papeis.ts): cadastrar gente e definir o que cada um vê é a chave do
// controle de acesso inteiro. O cadastro exige o papel da pessoa nova
// (nunca um default silencioso); mudar o papel de quem já existe é
// PATCH /api/equipe/[id]. Postgres direto via lib/db.ts.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { NOME_COOKIE_ACCESS, exigirPapel, gerarSenhaTemporaria, hashSenha, obterContextoAutenticado } from "@/lib/auth";
import { detalhesDoErro } from "@/lib/validacao";
import { PAPEIS } from "@/lib/papeis";

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "equipe");
  if (negado) return negado;

  // NUNCA senha_hash — select explícito de colunas, não "select *", pra
  // este campo estruturalmente não poder vazar na resposta.
  const colegas = await query(`select id, nome, email, papel, ativo, criado_em from equipe_nexaigen order by criado_em asc`);
  return NextResponse.json({ colegas });
}

const CadastrarColegaSchema = z.object({
  nome: z.string().trim().min(2, { error: "Informe o nome completo." }),
  // trim ANTES do formato: no zod 4 z.email() é um tipo próprio — `.pipe()` garante a ordem.
  email: z.string().trim().pipe(z.email({ error: "E-mail inválido." })),
  papel: z.enum(PAPEIS, { error: `Papel inválido — use um destes: ${PAPEIS.join(", ")}.` })
});

// Nome EXATO da constraint (db/migrations/0001_initial.sql) — comparação
// por IGUALDADE, nunca substring, na checagem de corrida do 23505 abaixo.
const CONSTRAINT_EMAIL_DUPLICADO = "equipe_nexaigen_email_unico";

export async function POST(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "equipe");
  if (negado) return negado;

  const parsed = CadastrarColegaSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  }
  const { nome, email, papel } = parsed.data;
  const emailNormalizado = email.toLowerCase();

  // Checagem antecipada — mensagem clara antes do catch de 23505 abaixo
  // (que continua existindo pra uma corrida genuína entre esta leitura e
  // o INSERT).
  const existentes = await query(`select id from equipe_nexaigen where email = $1`, [emailNormalizado]);
  if (existentes.length > 0) {
    return NextResponse.json({ erro: "Já existe uma conta de equipe com este e-mail." }, { status: 400 });
  }

  // Senha temporária devolvida na própria resposta UMA VEZ — não existe
  // canal de notificação real nesta plataforma interna, quem cadastrou
  // repassa manualmente pro colega novo.
  const senhaTemporaria = gerarSenhaTemporaria();
  const senhaHash = await hashSenha(senhaTemporaria);

  try {
    const linhas = await query<{ id: string }>(
      `insert into equipe_nexaigen (nome, email, senha_hash, papel) values ($1, $2, $3, $4) returning id`,
      [nome, emailNormalizado, senhaHash, papel]
    );
    return NextResponse.json({
      id: linhas[0].id,
      nome,
      email: emailNormalizado,
      papel,
      senhaTemporaria,
      aviso: "Guarde esta senha — ela não será mostrada de novo. Passe-a para o colega; será exigida a troca no primeiro acesso em /login."
    });
  } catch (erro) {
    // Corrida genuína entre a checagem antecipada e o INSERT — o driver
    // "pg" expõe o MESMO código de erro Postgres que o Supabase já
    // repassava (`erro.code === "23505"` pra unique_violation; confirmado
    // lendo a documentação do driver "pg" — o campo `code` vem direto do
    // protocolo do Postgres, não é uma tradução própria de nenhum dos dois
    // clientes, então o formato é idêntico nos dois).
    if (erro && typeof erro === "object" && "code" in erro && erro.code === "23505") {
      const constraint = "constraint" in erro ? String((erro as { constraint?: unknown }).constraint) : "";
      if (constraint === CONSTRAINT_EMAIL_DUPLICADO) {
        return NextResponse.json({ erro: "Já existe uma conta de equipe com este e-mail." }, { status: 400 });
      }
    }
    throw erro;
  }
}
