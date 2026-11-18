// Entidades intermunicipais (rodada 16-A2) — associações de municípios,
// consórcios intermunicipais etc.
// GET  ?busca= (nome ou sigla) — área "crm" (admin e vendas: dado
//      institucional). Contagens por entidade (municípios, clientes, em
//      negociação, não abordados, % de clientes) pela MESMA função de status
//      do Território.
// POST — SÓ ADMIN (área "crm_gestao"): cadastra. Fonte (URL) e data de
//      verificação obrigatórias; data no futuro → 400; mesmo nome + UF → 409.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { escopoDe } from "@/lib/crmHttp";
import { BuscaEntidadesSchema, EntidadeCamposSchema } from "@/lib/entidadeSchemas";
import { criarEntidade } from "@/lib/entidadesServico";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { listarEntidades } from "@/lib/territorioRepositorio";
import { ENTIDADE_NAO_ENCONTRADA, respostaDeFalhaSimples } from "@/lib/territorioHttp";
import { detalhesDoErro } from "@/lib/validacao";

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const parsed = BuscaEntidadesSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ erro: "Filtros inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const entidades = await listarEntidades(escopoDe(contexto!), hojeEmSaoPaulo(new Date()), parsed.data.busca);
  return NextResponse.json({ entidades }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm_gestao");
  if (negado) return negado;

  const parsed = EntidadeCamposSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const r = await criarEntidade(parsed.data, hojeEmSaoPaulo(new Date()));
  return r.ok ? NextResponse.json({ id: r.id }, { status: 201 }) : respostaDeFalhaSimples(r, ENTIDADE_NAO_ENCONTRADA);
}
