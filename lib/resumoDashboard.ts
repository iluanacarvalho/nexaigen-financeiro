// Números do Dashboard (app/(protegido)/page.tsx) — desde a rodada 08 vêm
// da MESMA função do Painel e de GET /api/painel-financeiro
// (lib/painelFinanceiroRepositorio.ts#obterPainelFinanceiro): status
// DERIVADO pela data de hoje (lib/estadoNota.ts, via diagnosticarNota) e
// valores em CENTAVOS inteiros. Antes o Dashboard lia a coluna status
// gravada (até 1 dia defasada) e somava `Number(valor)` em ponto
// flutuante — podia mostrar um "em aberto" diferente do Painel no mesmo
// minuto. A igualdade dos dois é conferida contra Postgres real em
// app/api/painel-financeiro/consistencia.integration.test.ts.

import { query } from "./db";
import { obterPainelFinanceiro } from "./painelFinanceiroRepositorio";
import type { PainelFinanceiro } from "./painelFinanceiro";

export interface ResumoDashboard {
  semNotas: boolean;
  /** Notas em aberto por situação (null sem nenhuma nota — o Dashboard mostra "—"). */
  contagemPorSituacao: PainelFinanceiro["kpis"]["contagemPorSituacao"];
  /** Total em aberto (não pago, não cancelado), em centavos. null sem nenhuma nota. */
  emAbertoCentavos: number | null;
  alertasCriticosAtivos: number;
}

export function montarResumoDashboard(painel: PainelFinanceiro, alertasCriticosAtivos: number): ResumoDashboard {
  return {
    semNotas: painel.semNotas,
    contagemPorSituacao: painel.kpis.contagemPorSituacao,
    emAbertoCentavos: painel.kpis.aReceber?.totalCentavos ?? null,
    alertasCriticosAtivos
  };
}

export async function obterResumoDashboard(agora: Date = new Date()): Promise<ResumoDashboard> {
  const [painel, [{ total }]] = await Promise.all([
    obterPainelFinanceiro(agora),
    query<{ total: number }>(`select count(*)::int as total from alerta_cobranca where status <> 'resolvido' and tipo = 'atraso_60_dias'`)
  ]);
  return montarResumoDashboard(painel, total);
}
