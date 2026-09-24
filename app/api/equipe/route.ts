// Gestão da própria equipe NEXAIGEN — GET lista colegas, POST cadastra um
// colega novo. Exige sessão válida nos dois métodos (exigirSessao) — SEM
// hierarquia: qualquer pessoa já logada pode cadastrar outra (não existe
// "papel" nesta identidade, ver lib/auth.ts).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { NOME_COOKIE_ACCESS, exigirSessao, gerarSenhaTemporaria, hashSenha, obterContextoAutenticado } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirSessao(contexto);
  if (negado) return negado;

  const supabase = supabaseAdmin();
  // NUNCA senha_hash — select explícito de colunas, não "*", pra este
  // campo estruturalmente não poder vazar na resposta.
  const { data, error } = await supabase
    .from("equipe_nexaigen")
    .select("id, nome, email, ativo, criado_em")
    .order("criado_em", { ascending: true });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ colegas: data });
}

const CadastrarColegaSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome completo."),
  email: z.string().trim().email("E-mail inválido.")
});

export async function POST(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirSessao(contexto);
  if (negado) return negado;

  const parsed = CadastrarColegaSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const { nome, email } = parsed.data;
  const emailNormalizado = email.toLowerCase();

  const supabase = supabaseAdmin();

  // Checagem antecipada — mensagem clara em vez de deixar o erro de
  // constraint única do Postgres (23505) ser o único jeito de saber o
  // que houve.
  const { data: existente } = await supabase.from("equipe_nexaigen").select("id").eq("email", emailNormalizado).maybeSingle();
  if (existente) {
    return NextResponse.json({ erro: "Já existe uma conta de equipe com este e-mail." }, { status: 400 });
  }

  // Senha temporária devolvida na própria resposta UMA VEZ — não existe
  // canal de notificação real nesta plataforma interna, quem cadastrou
  // repassa manualmente pro colega novo.
  const senhaTemporaria = gerarSenhaTemporaria();
  const senhaHash = await hashSenha(senhaTemporaria);

  const { data: novoColega, error } = await supabase
    .from("equipe_nexaigen")
    .insert({ nome, email: emailNormalizado, senha_hash: senhaHash })
    .select("id")
    .single();

  if (error) {
    // Corrida genuína entre a checagem antecipada e o INSERT (código 23505
    // = unique_violation) — mesma mensagem clara, nunca um 500 cru.
    if (error.code === "23505") {
      return NextResponse.json({ erro: "Já existe uma conta de equipe com este e-mail." }, { status: 400 });
    }
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  return NextResponse.json({
    id: novoColega.id,
    nome,
    email: emailNormalizado,
    senhaTemporaria,
    aviso: "Guarde esta senha — ela não será mostrada de novo. Passe-a para o colega; será exigida a troca no primeiro acesso em /login."
  });
}
