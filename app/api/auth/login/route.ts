// Login da equipe NEXAIGEN — 401 genérico se e-mail não existe OU senha
// errada (nunca revela qual dos dois), 403 se a conta estiver inativa.
// Emite access token (JWT, 15min) + refresh token (7 dias, hash gravado
// em `sessao`).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  DURACAO_REFRESH_TOKEN_MS,
  NOME_COOKIE_ACCESS,
  NOME_COOKIE_REFRESH,
  gerarAccessToken,
  gerarRefreshToken,
  hashRefreshToken,
  opcoesCookieAccessToken,
  opcoesCookieRefreshToken,
  verificarSenha
} from "@/lib/auth";

const LoginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1)
});

const ERRO_GENERICO = { erro: "E-mail ou senha inválidos." } as const;

export async function POST(req: NextRequest) {
  const parsed = LoginSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const { email, senha } = parsed.data;

  const supabase = supabaseAdmin();
  const { data: conta, error } = await supabase
    .from("equipe_nexaigen")
    .select("id, nome, senha_hash, senha_temporaria, token_version, ativo")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (error || !conta || !(await verificarSenha(senha, conta.senha_hash))) {
    return NextResponse.json(ERRO_GENERICO, { status: 401 });
  }

  if (!conta.ativo) {
    return NextResponse.json({ erro: "Conta desativada. Fale com um colega da equipe." }, { status: 403 });
  }

  const accessToken = await gerarAccessToken({
    equipeId: conta.id,
    nome: conta.nome,
    precisaTrocarSenha: conta.senha_temporaria,
    tokenVersion: conta.token_version
  });
  const refreshToken = gerarRefreshToken();
  await supabase.from("sessao").insert({
    equipe_id: conta.id,
    refresh_token_hash: hashRefreshToken(refreshToken),
    expira_em: new Date(Date.now() + DURACAO_REFRESH_TOKEN_MS).toISOString()
  });

  const resposta = NextResponse.json({
    nome: conta.nome,
    precisa_trocar_senha: conta.senha_temporaria
  });
  resposta.cookies.set(NOME_COOKIE_ACCESS, accessToken, opcoesCookieAccessToken());
  resposta.cookies.set(NOME_COOKIE_REFRESH, refreshToken, opcoesCookieRefreshToken());
  return resposta;
}
