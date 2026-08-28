// Lógica de prazos e escalonamento — o núcleo do sistema financeiro.
//
// Regra legal de referência: Lei nº 14.133/2021, Art. 141 — pagamento em
// até 30 dias corridos contados da liquidação/atesto, salvo disposição
// diversa no edital/contrato. Ajuste PRAZO_PAGAMENTO_DIAS se algum
// contrato específico tiver prazo diferente.
//
// Todos os limiares abaixo são parametrizáveis — não são exigência legal,
// são decisão operacional da NEXAIGEN sobre quando vale alertar.

export const PRAZO_PAGAMENTO_DIAS = 30;

export const LIMIAR_SEM_ATESTO_DIAS = 20; // sem atesto registrado após X dias da emissão -> investigar
export const LIMIAR_AVISO_VENCIMENTO_DIAS = 5; // avisa X dias antes do vencimento
export const LIMIAR_ATRASO_CRITICO_DIAS = 60; // atraso a partir do vencimento -> aciona cobrança

function diasEntre(dataInicio: Date, dataFim: Date): number {
  const MS_POR_DIA = 1000 * 60 * 60 * 24;
  return Math.floor((dataFim.getTime() - dataInicio.getTime()) / MS_POR_DIA);
}

export function calcularDataLimitePagamento(dataAtestoISO: string): string {
  const data = new Date(dataAtestoISO);
  data.setDate(data.getDate() + PRAZO_PAGAMENTO_DIAS);
  return data.toISOString().slice(0, 10);
}

export interface EstadoNota {
  temAtesto: boolean;
  temPagamento: boolean;
  dataEmissao: string;
  dataAtesto: string | null;
  dataLimitePagamento: string | null;
}

export interface DiagnosticoNota {
  statusDerivado:
    | "aguardando_atesto"
    | "atesto_atrasado" // sem atesto há mais de LIMIAR_SEM_ATESTO_DIAS
    | "atestada_aguardando_pagamento"
    | "vencendo_em_breve"
    | "vencida"
    | "atraso_critico" // >= 60 dias de atraso -> gatilho de cobrança
    | "paga";
  diasSemAtesto: number | null;
  diasParaVencer: number | null;
  diasDeAtraso: number | null;
  deveGerarAlerta: import("./tipos").TipoAlerta | null;
}

/** Função pura — dado o estado de uma nota, decide o status e se deve gerar alerta. Fácil de testar. */
export function diagnosticarNota(nota: EstadoNota, hoje: Date = new Date()): DiagnosticoNota {
  if (nota.temPagamento) {
    return { statusDerivado: "paga", diasSemAtesto: null, diasParaVencer: null, diasDeAtraso: null, deveGerarAlerta: null };
  }

  if (!nota.temAtesto) {
    const diasSemAtesto = diasEntre(new Date(nota.dataEmissao), hoje);
    const atrasado = diasSemAtesto > LIMIAR_SEM_ATESTO_DIAS;
    return {
      statusDerivado: atrasado ? "atesto_atrasado" : "aguardando_atesto",
      diasSemAtesto,
      diasParaVencer: null,
      diasDeAtraso: null,
      deveGerarAlerta: atrasado ? "sem_atesto_prolongado" : null
    };
  }

  // Tem atesto, ainda não tem pagamento
  const limite = nota.dataLimitePagamento ?? calcularDataLimitePagamento(nota.dataAtesto!);
  const diasParaVencer = diasEntre(hoje, new Date(limite));
  const diasDeAtraso = diasEntre(new Date(limite), hoje);

  if (diasDeAtraso >= LIMIAR_ATRASO_CRITICO_DIAS) {
    return { statusDerivado: "atraso_critico", diasSemAtesto: null, diasParaVencer, diasDeAtraso, deveGerarAlerta: "atraso_60_dias" };
  }
  if (diasDeAtraso > 0) {
    return { statusDerivado: "vencida", diasSemAtesto: null, diasParaVencer, diasDeAtraso, deveGerarAlerta: "vencido" };
  }
  if (diasParaVencer <= LIMIAR_AVISO_VENCIMENTO_DIAS) {
    return { statusDerivado: "vencendo_em_breve", diasSemAtesto: null, diasParaVencer, diasDeAtraso: 0, deveGerarAlerta: "proximo_vencimento" };
  }
  return { statusDerivado: "atestada_aguardando_pagamento", diasSemAtesto: null, diasParaVencer, diasDeAtraso: 0, deveGerarAlerta: null };
}
