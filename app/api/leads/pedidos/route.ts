// CRM — pedidos de reatribuição PENDENTES (rodada 16-A, ajuste). SÓ ADMIN
// (área "crm_gestao"). GET → { pedidos: [{ id, lead_id, municipio_nome, uf,
// dono_nome, solicitante_nome, em }] }.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { listarPedidosPendentes } from "@/lib/crmRepositorio";

export async function GET(req: NextRequest) {
  const negado = exigirPapel(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value), "crm_gestao");
  if (negado) return negado;
  return NextResponse.json({ pedidos: await listarPedidosPendentes() }, { headers: { "cache-control": "no-store" } });
}
