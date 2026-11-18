// Excluir uma visão salva (rodada 16-A2). Área "crm". Só a PRÓPRIA: visão de
// outra pessoa "não existe" → 404 (nunca 403 — não deixa enumerar).

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { excluirVisao } from "@/lib/visoesServico";
import { ehUuid } from "@/lib/validacao";

const NAO_ENCONTRADA = "Visão não encontrada.";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ erro: NAO_ENCONTRADA }, { status: 404 });
  const r = await excluirVisao(contexto!.equipeId, id);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ erro: NAO_ENCONTRADA }, { status: 404 });
}
