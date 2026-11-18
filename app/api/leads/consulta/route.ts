// CRM — "Já existe esse lead?" (rodada 16-A, ajuste). Área "crm" (admin e
// vendas). Busca em TODOS os leads, de qualquer vendedor, por nome (sem
// acento/caixa), UF e/ou código IBGE, e devolve SÓ os campos mínimos
// (lib/crmRepositorio.ts#consultarLeads — colunas escritas uma a uma):
// { id, municipio_nome, uf, etapa, vendedor_nome, ultima_atividade_em (dia),
//   meu_lead, pode_pedir }. Nunca contato, valor, plano, origem, motivo,
//   notas, histórico ou próxima ação.
// GET ?busca=&uf=&codigo_ibge=&pagina=&por_pagina= (máx. 100) — ao menos um dos três.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { ConsultaLeadsSchema } from "@/lib/crmSchemas";
import { consultarLeads } from "@/lib/crmRepositorio";
import { escopoDe } from "@/lib/crmHttp";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { detalhesDoErro } from "@/lib/validacao";

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const parsed = ConsultaLeadsSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ erro: "Filtros inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const f = parsed.data;
  const { leads, total } = await consultarLeads(
    { busca: f.busca, uf: f.uf, codigoIbge: f.codigo_ibge, pagina: f.pagina, porPagina: f.por_pagina },
    escopoDe(contexto!),
    hojeEmSaoPaulo(new Date())
  );
  return NextResponse.json({ leads, total, pagina: f.pagina, por_pagina: f.por_pagina }, { headers: { "cache-control": "no-store" } });
}
