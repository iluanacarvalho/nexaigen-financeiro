// GET /api/configuracao/status — o que está configurado no ambiente, só
// booleanos (lib/statusConfiguracao.ts), mais os avisos em linguagem
// simples que o Dashboard também mostra. Exige sessão da equipe: mesmo sem
// valores, a lista do que falta é informação operacional interna.
// Nenhum valor de variável sai daqui, nem pra log.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { avisosDeConfiguracao, lerStatusConfiguracao } from "@/lib/statusConfiguracao";

export async function GET(req: NextRequest) {
  const negado = exigirPapel(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value), "configuracao");
  if (negado) return negado;

  const status = lerStatusConfiguracao();
  return NextResponse.json({ status, avisos: avisosDeConfiguracao(status) }, { headers: { "cache-control": "no-store" } });
}
