// Cancelamento de contrato pela equipe (tela de Clientes, rodada 12-A).
// Exige sessão (exigirPapel); o autor do evento de auditoria é SEMPRE a
// sessão, nunca o corpo da requisição.
//
// POST   { dataPedido, motivo } → registra o ofício: 'ativo' → 'em_aviso_previo',
//        término = dataPedido + 30 (se o término já passou, encerra na mesma
//        transação). 200 { statusContrato, pedidoEm, terminoEm }.
// DELETE → retrata: 'em_aviso_previo' → 'ativo', só até a data de término.
// 400 dado inválido · 404 cliente inexistente · 409 transição inválida
// (inclusive repetir a mesma ação: pra quem clicou, nada mudou).
// Regras: lib/cancelamentoContrato.ts; escrita (transação + evento):
// lib/cancelamentoServico.ts.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { RegistrarCancelamentoSchema } from "@/lib/cancelamentoSchemas";
import { registrarCancelamento, retratarCancelamento, type ResultadoContrato } from "@/lib/cancelamentoServico";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

const NAO_ENCONTRADO = "Cliente não encontrado.";

function responder(r: ResultadoContrato, semMudanca: string): NextResponse {
  if (r.ok) {
    if (!r.mudou) return NextResponse.json({ erro: semMudanca }, { status: 409 });
    return NextResponse.json({ statusContrato: r.statusContrato, pedidoEm: r.pedidoEm, terminoEm: r.terminoEm });
  }
  switch (r.motivo) {
    case "nao_encontrado":
      return NextResponse.json({ erro: NAO_ENCONTRADO }, { status: 404 });
    case "dados_invalidos":
      return NextResponse.json({ erro: "Dados inválidos", detalhes: { formErrors: [], fieldErrors: { dataPedido: [r.erro] } } }, { status: 400 });
    case "transicao_invalida":
      return NextResponse.json({ erro: r.erro }, { status: 409 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "clientes");
  if (negado) return negado;

  const { id } = await params;
  const parsed = RegistrarCancelamentoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: NAO_ENCONTRADO }, { status: 404 });

  const r = await registrarCancelamento(
    id,
    { dataPedido: parsed.data.dataPedido, motivo: parsed.data.motivo },
    { origem: "painel", equipeId: contexto!.equipeId },
    hojeEmSaoPaulo(new Date())
  );
  return responder(r, "Este cancelamento já está registrado com esta data de ofício.");
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "clientes");
  if (negado) return negado;

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ erro: NAO_ENCONTRADO }, { status: 404 });

  const r = await retratarCancelamento(id, { origem: "painel", equipeId: contexto!.equipeId }, hojeEmSaoPaulo(new Date()));
  return responder(r, "Este cancelamento já foi retratado — o contrato está ativo.");
}
