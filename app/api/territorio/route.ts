// Território comercial (rodada 16-A2). Área "crm" (admin e vendas;
// financeiro e rh → 403). GET com os filtros da tela na query string
// (lib/territorio.ts#lerFiltrosTerritorio — valor inválido é IGNORADO com
// aviso, nunca 400: o link compartilhável não quebra) →
// { filtros, avisos, uf, total, resumo, linhas (a página), pagina, por_pagina }.
// Vendas: só estados liberados; lead de colega = só vendedor e etapa.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { escopoDe } from "@/lib/crmHttp";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { POR_PAGINA_TERRITORIO, montarQueryTerritorio } from "@/lib/territorio";
import { consultarTerritorio } from "@/lib/territorioConsulta";

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const r = await consultarTerritorio(req.nextUrl.searchParams, escopoDe(contexto!), hojeEmSaoPaulo(new Date()));
  return NextResponse.json(
    { filtros: montarQueryTerritorio(r.filtros), avisos: r.avisos, uf: r.uf, total: r.total, resumo: r.resumo, linhas: r.pagina, pagina: r.filtros.pagina, por_pagina: POR_PAGINA_TERRITORIO },
    { headers: { "cache-control": "no-store" } }
  );
}
