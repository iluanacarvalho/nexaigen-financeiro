// GET /api/notas/[id]/eventos — histórico da nota (criação, checagens no
// portal, atesto, pagamento, cancelamento, reabertura), do mais antigo pro
// mais recente, com o NOME de quem fez (nunca e-mail). Exige sessão.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import { listarEventos } from "@/lib/notasServico";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });

  const eventos = await listarEventos(id);
  if (eventos === null) return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });
  return NextResponse.json({ eventos }, { headers: { "cache-control": "no-store" } });
}
