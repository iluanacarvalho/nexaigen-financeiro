// Proxy do Next (antigo "middleware") — rodada 15-B. ÚNICO uso: os
// cabeçalhos de segurança da página PÚBLICA /mapa, montados em TEMPO DE
// EXECUÇÃO a partir de MAPA_PUBLICO_ORIGENS (assim mudar a variável no
// servidor vale sem novo build). NÃO faz autenticação nem redirecionamento
// nenhum — o login continua nos layouts/rotas (lib/authPagina.ts,
// lib/auth.ts#exigirPapel); /mapa e /api/publico ficam fora de qualquer
// login (proxy.test.ts confere).
//
//   - Content-Security-Policy (lib/origensMapaPublico.ts#cspDoMapa): nada de
//     outro domínio na página, e frame-ancestors = a própria origem + as
//     origens autorizadas a incorporar o mapa por iframe;
//   - o resto do app é bloqueado contra iframe em next.config.js
//     (X-Frame-Options DENY + frame-ancestors 'none'), que exclui /mapa.

import { NextResponse } from "next/server";
import { cspDoMapa, lerOrigensMapaPublico } from "./lib/origensMapaPublico";

export function proxy() {
  const resposta = NextResponse.next();
  resposta.headers.set("content-security-policy", cspDoMapa(lerOrigensMapaPublico(process.env.MAPA_PUBLICO_ORIGENS), process.env.NODE_ENV === "development"));
  resposta.headers.set("x-content-type-options", "nosniff");
  resposta.headers.set("referrer-policy", "no-referrer");
  return resposta;
}

export const config = {
  matcher: "/mapa"
};
