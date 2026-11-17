// Ação central da Fila de Checagem: alguém do time entra no portal da
// prefeitura, confere o status e registra o que viu.
//
// Desde a rodada 08 esta rota NÃO tem regra própria: "atestada" e "paga"
// passam pela MESMA função da tela de Notas (lib/notasServico.ts#
// executarAcaoNota — máquina de estados de lib/estadoNota.ts), e "ainda
// sem atesto"/"erro de acesso" por registrarVerificacaoSemMudanca. Em
// todos os casos TODAS as escritas (evento_verificacao + update da nota +
// evento no histórico + resolução de alertas) são UMA transação.
//
// Mudança de comportamento documentada: "paga" numa nota ainda sem atesto
// agora é 409 (antes gravava o pagamento sem atesto) — mesma regra da tela
// de Notas: registre o atesto antes (lib/estadoNota.ts, FASES_DE_ORIGEM).
//
// `verificado_por` vem SEMPRE da sessão (contexto.equipeId), nunca do corpo.
// data_evento: aaaa-mm-dd, não no futuro, não antes da emissão (ou do
// atesto, no pagamento); ausente = hoje (America/Sao_Paulo).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { executarAcaoNota, registrarVerificacaoSemMudanca } from "@/lib/notasServico";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

const VerificacaoSchema = z.strictObject({
    resultado: z.enum(["sem_atesto_ainda", "atestada", "paga", "erro_acesso_portal"]),
    data_evento: z.string().max(10).optional(),
    observacao: z.string().trim().max(1000).optional()
});

// UPGRADE Next.js 16: `params` de route handlers dinâmicos é uma Promise.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "checagem");
  if (negado) return negado;

  const parsed = VerificacaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });
  const { resultado, data_evento, observacao } = parsed.data;
  const hoje = hojeEmSaoPaulo(new Date());
  const obs = observacao ? observacao : null;

  if (resultado === "sem_atesto_ainda" || resultado === "erro_acesso_portal") {
    const existe = await registrarVerificacaoSemMudanca(id, resultado, obs, contexto!.equipeId, hoje);
    return existe ? NextResponse.json({ ok: true }) : NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });
  }

  const r = await executarAcaoNota(
    id,
    resultado === "atestada" ? "registrar_atesto" : "registrar_pagamento",
    { dataEvento: data_evento ?? hoje, verificacao: { resultado, observacao: obs } },
    contexto!.equipeId,
    hoje
  );
  if (r.ok) return NextResponse.json({ ok: true, status_novo: r.statusNovo });
  if (r.motivo === "nao_encontrada") return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });
  return NextResponse.json({ erro: r.erro }, { status: r.motivo === "transicao_invalida" ? 409 : 400 });
}
