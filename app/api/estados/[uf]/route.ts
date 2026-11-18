// Liberar/bloquear um estado pro comercial (rodada 16-A2). SÓ ADMIN (área
// "crm_gestao"). PUT { liberado: true | false }. Em PRODUÇÃO é a ÚNICA forma
// de liberar um estado (a migration 0016 só libera o PR em desenvolvimento).
// Vendas só vê no Território os estados liberados.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { UFS_BRASIL } from "@/lib/entidades";
import { LiberarEstadoSchema } from "@/lib/entidadeSchemas";
import { liberarEstado } from "@/lib/entidadesServico";
import { detalhesDoErro } from "@/lib/validacao";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ uf: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm_gestao");
  if (negado) return negado;

  const { uf } = await params;
  const parsed = LiberarEstadoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const sigla = String(uf ?? "").toUpperCase();
  if (!UFS_BRASIL.includes(sigla)) return NextResponse.json({ erro: "UF não encontrada." }, { status: 404 });
  await liberarEstado(sigla, parsed.data.liberado, contexto!.equipeId);
  return NextResponse.json({ uf: sigla, liberado: parsed.data.liberado });
}
