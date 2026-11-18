// Busca global do CRM (rodada 16-A2): nome/sigla de entidade e nome/código
// de município. Área "crm"; só o que quem lê pode ver (vendas: estados
// liberados). GET ?q= → { entidades, municipios }.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { escopoDe } from "@/lib/crmHttp";
import { buscarNoCrm } from "@/lib/territorioRepositorio";
import { BuscaGlobalSchema } from "@/lib/territorioSchemas";
import { detalhesDoErro } from "@/lib/validacao";

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const parsed = BuscaGlobalSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ erro: "Filtros inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  return NextResponse.json(await buscarNoCrm(parsed.data.q, escopoDe(contexto!)), { headers: { "cache-control": "no-store" } });
}
