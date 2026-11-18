// CRM — admin decide um pedido de reatribuição (rodada 16-A, ajuste). SÓ
// ADMIN (área "crm_gestao"). POST { decisao: "aprovado" | "negado" }.
// Aprovar = troca de vendedor pro solicitante, com 'troca_vendedor' no
// histórico, na mesma transação (lib/crmServico.ts#decidirPedido).
// 404 pedido inexistente · 409 já decidido.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { DecisaoPedidoSchema } from "@/lib/crmSchemas";
import { decidirPedido } from "@/lib/crmServico";
import { escopoDe, respostaDeFalha } from "@/lib/crmHttp";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

const NAO_ENCONTRADO = "Pedido não encontrado.";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm_gestao");
  if (negado) return negado;

  const { id } = await params;
  const parsed = DecisaoPedidoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: NAO_ENCONTRADO }, { status: 404 });
  const r = await decidirPedido(id, parsed.data.decisao, escopoDe(contexto!));
  return r.ok ? NextResponse.json({ decisao: r.decisao }) : respostaDeFalha(r, NAO_ENCONTRADO);
}
