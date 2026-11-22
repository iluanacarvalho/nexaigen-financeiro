// Modelos de contrato (rodada 16-B1). SÓ ADMIN (área "modelos_contrato").
// GET  → { modelos, campos } (todas as versões dos 4 planos + a lista FECHADA de campos)
// POST { plano, titulo, conteudo } → 201 { id, versao } — "editar" = criar
//      uma versão NOVA em rascunho (a anterior nunca muda — trigger da 0017).
//      Campo desconhecido / chaves soltas no texto → 400 (descoberto ao
//      SALVAR, nunca só na hora de gerar).

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { CAMPOS_MODELO } from "@/lib/contratoModelo";
import { NovaVersaoModeloSchema } from "@/lib/fechamentoSchemas";
import { criarVersaoModelo, listarModelos } from "@/lib/modelosContratoServico";
import { detalhesDoErro } from "@/lib/validacao";

export async function GET(req: NextRequest) {
  const negado = exigirPapel(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value), "modelos_contrato");
  if (negado) return negado;
  return NextResponse.json({ modelos: await listarModelos(), campos: CAMPOS_MODELO }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "modelos_contrato");
  if (negado) return negado;

  const parsed = NovaVersaoModeloSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const r = await criarVersaoModelo(parsed.data, contexto!.equipeId);
  if (r.ok) return NextResponse.json({ id: r.id, versao: r.versao }, { status: 201 });
  if (r.motivo === "dados_invalidos") return NextResponse.json({ erro: "Dados inválidos", detalhes: { formErrors: [], fieldErrors: { conteudo: [r.erro] } } }, { status: 400 });
  return NextResponse.json({ erro: r.motivo === "conflito" ? r.erro : "Modelo não encontrado." }, { status: r.motivo === "conflito" ? 409 : 404 });
}
