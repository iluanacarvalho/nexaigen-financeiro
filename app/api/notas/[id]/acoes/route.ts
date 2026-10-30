// POST /api/notas/[id]/acoes — registrar atesto, registrar pagamento,
// cancelar, reabrir pagamento. Exige sessão; quem fez a ação vem SEMPRE da
// sessão (contexto.equipeId), nunca do corpo. Transição validada pela
// máquina de estados (lib/estadoNota.ts) DENTRO da transação, com a nota
// travada (lib/notasServico.ts).
//
// Corpo: { acao, data? (aaaa-mm-dd — atesto/pagamento), motivo? (cancelar/reabrir, obrigatório, até 300) }
// 200 { ok, status_anterior, status_novo } · 400 dado inválido · 404 nota
// inexistente · 409 transição não permitida (ex.: pagar nota cancelada).

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { AcaoNotaSchema } from "@/lib/notaSchemas";
import { executarAcaoNota } from "@/lib/notasServico";
import { lerMotivoObrigatorio } from "@/lib/estadoNota";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirSessao(contexto);
  if (negado) return negado;

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });

  const parsed = AcaoNotaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const { acao, data, motivo } = parsed.data;

  let motivoValidado: string | null = null;
  if (acao === "cancelar" || acao === "reabrir_pagamento") {
    const m = lerMotivoObrigatorio(motivo);
    if (!m.ok) return NextResponse.json({ erro: m.erro }, { status: 400 });
    motivoValidado = m.motivo;
  }

  const resultado = await executarAcaoNota(id, acao, { dataEvento: data ?? null, motivo: motivoValidado }, contexto!.equipeId, hojeEmSaoPaulo(new Date()));
  if (resultado.ok) return NextResponse.json({ ok: true, status_anterior: resultado.statusAnterior, status_novo: resultado.statusNovo });
  if (resultado.motivo === "nao_encontrada") return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });
  return NextResponse.json({ erro: resultado.erro }, { status: resultado.motivo === "transicao_invalida" ? 409 : 400 });
}
