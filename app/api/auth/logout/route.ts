// Logout — revoga a sessão (refresh token) atual e limpa os cookies.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { NOME_COOKIE_ACCESS, NOME_COOKIE_REFRESH, hashRefreshToken, opcoesCookieAccessToken, opcoesCookieRefreshToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(NOME_COOKIE_REFRESH)?.value;
  if (refreshToken) {
    await query(`update sessao set revogado_em = now() where refresh_token_hash = $1 and revogado_em is null`, [
      hashRefreshToken(refreshToken)
    ]);
  }

  const resposta = NextResponse.json({ ok: true });
  resposta.cookies.set(NOME_COOKIE_ACCESS, "", { ...opcoesCookieAccessToken(), maxAge: 0 });
  resposta.cookies.set(NOME_COOKIE_REFRESH, "", { ...opcoesCookieRefreshToken(), maxAge: 0 });
  return resposta;
}
