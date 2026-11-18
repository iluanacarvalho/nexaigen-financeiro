// Mapa PÚBLICO das prefeituras atendidas (rodada 15-B) — ROTA PÚBLICA DE
// PROPÓSITO: sem login (o site institucional e a página /mapa leem daqui).
// app/api/protecao-rotas.test.ts declara esta rota como pública e confere
// que ela responde sem sessão (e que as demais continuam 401).
//
// Devolve EXATAMENTE { atualizadoEm, total, municipios: [{ nome, uf, lat, lon }] }
// — só clientes que AUTORIZARAM por escrito e têm contrato vigente hoje
// (lib/mapaPublico.ts). Nunca chama o IBGE: a posição já está gravada.
//
// Cabeçalhos: cache público de 60s (s-maxage/max-age — revogar tira do
// banco na hora; o cache de borda segura no máximo 1 minuto); CORS só pras
// origens de MAPA_PUBLICO_ORIGENS (lib/origensMapaPublico.ts — vazia = só a
// mesma origem; nunca "*"); nosniff. Rate limit por IP
// (LIMITE_MAPA_PUBLICO_POR_IP). Só GET: o Next responde 405 aos outros
// métodos porque este arquivo não exporta nenhum outro.

import { NextRequest, NextResponse } from "next/server";
import { obterMapaPublico } from "@/lib/mapaPublicoRepositorio";
import { cabecalhosCors, lerOrigensMapaPublico } from "@/lib/origensMapaPublico";
import { LIMITE_MAPA_PUBLICO_POR_IP, obterIpCliente, registrarTentativa, respostaLimiteExcedido } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  const limite = await registrarTentativa(LIMITE_MAPA_PUBLICO_POR_IP, obterIpCliente(req));
  if (!limite.permitido) return respostaLimiteExcedido(limite.retryAfterSegundos);

  const corpo = await obterMapaPublico();
  return NextResponse.json(corpo, {
    headers: {
      "cache-control": "public, s-maxage=60, max-age=60",
      "x-content-type-options": "nosniff",
      ...cabecalhosCors(req.headers.get("origin"), lerOrigensMapaPublico(process.env.MAPA_PUBLICO_ORIGENS))
    }
  });
}
