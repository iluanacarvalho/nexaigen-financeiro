// GET /api/clientes/[id]/contrato/versoes — histórico de versões do
// contrato (0009), da mais recente pra mais antiga, com `atual`. Exige
// sessão. Da pessoa que enviou, só o nome; versões vindas da integração
// com o Educa têm enviado_por_nome nulo (o motivo diz a origem).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import { ALVO_CONTRATO, donoExiste, listarVersoesPdf } from "@/lib/versionamentoPdf";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const { id: clienteId } = await params;
  if (!z.string().uuid().safeParse(clienteId).success || !(await donoExiste(ALVO_CONTRATO, clienteId))) {
    return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });
  }
  return NextResponse.json({ versoes: await listarVersoesPdf(ALVO_CONTRATO, clienteId) }, { headers: { "cache-control": "no-store" } });
}
