// CRM — números do funil (rodada 16-A). Área "crm"; no escopo de quem lê
// (vendas: só os seus leads). Mesma função da tela /crm
// (lib/crmRepositorio.ts#obterResumoCrm): abertos e valor, por etapa,
// ganhos no mês (aceites registrados — 16-B1), perdidos no mês, taxa de avanço,
// "minhas ações de hoje"; admin também carga por vendedor e pedidos pendentes.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { obterResumoCrm } from "@/lib/crmRepositorio";
import { escopoDe } from "@/lib/crmHttp";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;
  return NextResponse.json(await obterResumoCrm(escopoDe(contexto!), hojeEmSaoPaulo(new Date())), { headers: { "cache-control": "no-store" } });
}
