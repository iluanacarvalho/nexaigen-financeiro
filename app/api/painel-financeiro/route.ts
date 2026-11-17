// GET /api/painel-financeiro — visão gerencial (KPIs, série de 12 meses,
// tabela de clientes). Exige sessão da equipe (exigirPapel), mesmo padrão
// de toda rota administrativa: é dado financeiro consolidado da NEXAIGEN.
// Cálculo em lib/painelFinanceiro.ts (puro), leitura em
// lib/painelFinanceiroRepositorio.ts. Valores monetários em CENTAVOS
// inteiros (`*Centavos`) — ver o comentário de topo de lib/painelFinanceiro.ts.
//
// `?formato=csv` devolve a tabela de clientes como CSV (download), usado
// pelo link "Exportar CSV" de app/(protegido)/painel — mesma rota, mesma
// checagem de sessão, mesmos números da tela.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { obterPainelFinanceiro } from "@/lib/painelFinanceiroRepositorio";
import { gerarCsvClientes } from "@/lib/painelFinanceiro";

export async function GET(req: NextRequest) {
  const negado = exigirPapel(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value), "painel");
  if (negado) return negado;

  const painel = await obterPainelFinanceiro();

  if (req.nextUrl.searchParams.get("formato") === "csv") {
    return new NextResponse(gerarCsvClientes(painel.clientes), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="painel-clientes-${painel.hoje}.csv"`,
        "cache-control": "no-store"
      }
    });
  }

  return NextResponse.json(painel, { headers: { "cache-control": "no-store" } });
}
