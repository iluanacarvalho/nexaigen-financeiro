// CRM — "Pedir este lead" (rodada 16-A, ajuste): vendedor pede um lead de
// COLEGA que está aberto e sem atividade há mais de 60 dias. Área "crm".
// Grava o pedido e NÃO muda o dono — o admin aprova ou nega
// (POST /api/leads/pedidos/[id]). É a única escrita sobre lead de colega.
// POST (sem corpo) → 201 { id }. 404 lead inexistente · 409 lead é seu,
// ainda tem atividade recente, está fechado, ou já há pedido pendente seu.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { pedirLead } from "@/lib/crmServico";
import { LEAD_NAO_ENCONTRADO, escopoDe, respostaDeFalha } from "@/lib/crmHttp";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { ehUuid } from "@/lib/validacao";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ erro: LEAD_NAO_ENCONTRADO }, { status: 404 });
  const r = await pedirLead(id, escopoDe(contexto!), hojeEmSaoPaulo(new Date()));
  return r.ok ? NextResponse.json({ id: r.pedidoId }, { status: 201 }) : respostaDeFalha(r);
}
