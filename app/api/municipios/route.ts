// Busca de município na base territorial (rodada 16-A2) — por nome (sem
// acento/caixa) ou código IBGE. Área "crm". Só estados visíveis pra quem
// lê (vendas: liberados). GET ?busca=&uf= → { municipios: [{ codigo_ibge, nome, uf }] }

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { escopoDe } from "@/lib/crmHttp";
import { BuscaMunicipiosSchema } from "@/lib/entidadeSchemas";
import { buscarMunicipios } from "@/lib/territorioRepositorio";
import { detalhesDoErro } from "@/lib/validacao";

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const parsed = BuscaMunicipiosSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ erro: "Filtros inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const municipios = await buscarMunicipios(parsed.data.busca, escopoDe(contexto!), parsed.data.uf, 20);
  return NextResponse.json({ municipios }, { headers: { "cache-control": "no-store" } });
}
