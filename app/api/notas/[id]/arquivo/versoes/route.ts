// GET /api/notas/[id]/arquivo/versoes — histórico de versões do PDF da
// nota fiscal (0005), da mais recente pra mais antiga, com `atual`. Exige
// sessão. Da pessoa que enviou, só o NOME (nunca e-mail). Download de cada
// versão: GET /api/notas/[id]/arquivo?versao=N. Implementação
// compartilhada com o contrato: lib/versionamentoPdf.ts.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import { ALVO_PDF_NOTA, donoExiste, listarVersoesPdf } from "@/lib/versionamentoPdf";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const { id: notaId } = await params;
  if (!z.string().uuid().safeParse(notaId).success || !(await donoExiste(ALVO_PDF_NOTA, notaId))) {
    return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });
  }
  return NextResponse.json({ versoes: await listarVersoesPdf(ALVO_PDF_NOTA, notaId) }, { headers: { "cache-control": "no-store" } });
}
