// Login da equipe NEXAIGEN — 401 genérico se e-mail não existe OU senha
// errada (nunca revela qual dos dois), 403 se a conta estiver inativa.
// Emite access token (JWT, 15min) + refresh token (7 dias, hash gravado
// em `sessao`).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
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

interface ContaLinha {
  id: string;
  nome: string;
  senha_hash: string;
  senha_temporaria: boolean;
  token_version: number;
  ativo: boolean;
}

export async function POST(req: NextRequest) {
  const parsed = LoginSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const { email, senha } = parsed.data;

  const linhas = await query<ContaLinha>(
    `select id, nome, senha_hash, senha_temporaria, token_version, ativo from equipe_nexaigen where email = $1`,
    [email.trim().toLowerCase()]
  );
  const conta = linhas[0];

  if (!conta || !(await verificarSenha(senha, conta.senha_hash))) {
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
  await query(`insert into sessao (equipe_id, refresh_token_hash, expira_em) values ($1, $2, $3)`, [
    conta.id,
    hashRefreshToken(refreshToken),
    new Date(Date.now() + DURACAO_REFRESH_TOKEN_MS).toISOString()
  ]);

  const resposta = NextResponse.json({
    nome: conta.nome,
    precisa_trocar_senha: conta.senha_temporaria
  });
  resposta.cookies.set(NOME_COOKIE_ACCESS, accessToken, opcoesCookieAccessToken());
  resposta.cookies.set(NOME_COOKIE_REFRESH, refreshToken, opcoesCookieRefreshToken());
  return resposta;
}
