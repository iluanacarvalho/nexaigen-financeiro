// GET /api/notas/[id]/eventos — histórico da nota (criação, checagens no
// portal, atesto, pagamento, cancelamento, reabertura), do mais antigo pro
// mais recente, com o NOME de quem fez (nunca e-mail). Exige sessão.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import { listarEventos } from "@/lib/notasServico";
import { ehUuid } from "@/lib/validacao";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });

  const eventos = await listarEventos(id);
  if (eventos === null) return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });
  return NextResponse.json({ eventos }, { headers: { "cache-control": "no-store" } });
}
