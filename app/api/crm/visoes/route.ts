// Visões salvas do CRM (rodada 16-A2). Área "crm". CADA PESSOA VÊ SÓ AS
// SUAS (filtro por usuário no SQL — lib/visoesServico.ts).
// GET  ?tela=territorio|leads|entidade → { visoes }
// POST { nome, tela, filtros: { …parâmetros da URL da tela… } } → 201 { id }
//      nome repetido ou limite (30) → 409 · filtro que a tela não entende → 400

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { ListarVisoesSchema, NovaVisaoSchema } from "@/lib/territorioSchemas";
import { listarVisoes, salvarVisao } from "@/lib/visoesServico";
import { respostaDeFalhaSimples } from "@/lib/territorioHttp";
import { detalhesDoErro } from "@/lib/validacao";

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const parsed = ListarVisoesSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ erro: "Filtros inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  return NextResponse.json({ visoes: await listarVisoes(contexto!.equipeId, parsed.data.tela) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const parsed = NovaVisaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const r = await salvarVisao(contexto!.equipeId, parsed.data);
  return r.ok ? NextResponse.json({ id: r.id }, { status: 201 }) : respostaDeFalhaSimples(r, "Visão não encontrada.");
}
