// Aprovar uma versão de modelo de contrato (rodada 16-B1). SÓ ADMIN (área
// "modelos_contrato"). POST {} → { plano, versao } — registra quem e quando;
// a partir daí a geração usa esta versão (sem faixa de rascunho). 409 já aprovada.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { aprovarModelo } from "@/lib/modelosContratoServico";
import { ehUuid } from "@/lib/validacao";

const NAO_ENCONTRADO = "Modelo não encontrado.";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "modelos_contrato");
  if (negado) return negado;

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ erro: NAO_ENCONTRADO }, { status: 404 });
  const r = await aprovarModelo(id, contexto!.equipeId);
  if (r.ok) return NextResponse.json({ plano: r.plano, versao: r.versao });
  if (r.motivo === "nao_encontrado") return NextResponse.json({ erro: NAO_ENCONTRADO }, { status: 404 });
  return NextResponse.json({ erro: r.erro }, { status: r.motivo === "conflito" ? 409 : 400 });
}
