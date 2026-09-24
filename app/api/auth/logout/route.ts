// Logout — revoga a sessão (refresh token) atual e limpa os cookies.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { NOME_COOKIE_ACCESS, NOME_COOKIE_REFRESH, hashRefreshToken, opcoesCookieAccessToken, opcoesCookieRefreshToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(NOME_COOKIE_REFRESH)?.value;
  if (refreshToken) {
    const supabase = supabaseAdmin();
    await supabase
      .from("sessao")
      .update({ revogado_em: new Date().toISOString() })
      .eq("refresh_token_hash", hashRefreshToken(refreshToken))
      .is("revogado_em", null);
  }

  const resposta = NextResponse.json({ ok: true });
  resposta.cookies.set(NOME_COOKIE_ACCESS, "", { ...opcoesCookieAccessToken(), maxAge: 0 });
  resposta.cookies.set(NOME_COOKIE_REFRESH, "", { ...opcoesCookieRefreshToken(), maxAge: 0 });
  return resposta;
}
