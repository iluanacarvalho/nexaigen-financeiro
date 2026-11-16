// Máquina de estados da nota fiscal + validações de entrada — FUNÇÕES
// PURAS (sem banco, "hoje" sempre como parâmetro), testadas em
// lib/estadoNota.test.ts. Única fonte das regras de:
//   - que ação vale em que fase (atesto, pagamento, cancelamento, reabertura);
//   - qual status gravar depois de uma ação;
//   - a SITUAÇÃO atual de uma nota na data de hoje (a mesma que o Painel,
//     o Dashboard, a tela de Notas e o job diário usam).
// A escrita transacional que aplica estas regras é lib/notasServico.ts.

import { LIMIAR_ATRASO_CRITICO_DIAS, PRAZO_PAGAMENTO_DIAS, diagnosticarNota, type DiagnosticoNota } from "./prazos";
import type { StatusNota } from "./tipos";

export { LIMIAR_ATRASO_CRITICO_DIAS, PRAZO_PAGAMENTO_DIAS };

// --- Situação (status na data de hoje) ------------------------------------

/** O que a nota É hoje. Mesmo vocabulário de nota_fiscal.status, sem o legado "emitida". */
export type SituacaoNota = "aguardando_atesto" | "atestada" | "vencida" | "atraso_critico" | "paga" | "cancelada";

export const SITUACOES: readonly SituacaoNota[] = ["aguardando_atesto", "atestada", "vencida", "atraso_critico", "paga", "cancelada"];

export const ROTULO_SITUACAO_NOTA: Record<SituacaoNota, string> = {
  aguardando_atesto: "Aguardando atesto",
  atestada: "Atestada (no prazo)",
  vencida: "Vencida",
  atraso_critico: "Atraso crítico (≥60 dias)",
  paga: "Paga",
  cancelada: "Cancelada"
};

/**
 * statusDerivado de diagnosticarNota → status gravado em nota_fiscal.
 * Era o `mapearStatus` dentro do job diário; veio pra cá pra que o job, a
 * tela de Notas e o Painel usem exatamente o mesmo mapeamento.
 */
export function statusPersistidoDe(statusDerivado: DiagnosticoNota["statusDerivado"]): SituacaoNota {
  const mapa: Record<DiagnosticoNota["statusDerivado"], SituacaoNota> = {
    aguardando_atesto: "aguardando_atesto",
    atesto_atrasado: "aguardando_atesto",
    atestada_aguardando_pagamento: "atestada",
    vencendo_em_breve: "atestada",
    vencida: "vencida",
    atraso_critico: "atraso_critico",
    paga: "paga"
  };
  return mapa[statusDerivado];
}

export interface EstadoBasicoNota {
  status: string;
  data_emissao: string;
  data_atesto: string | null;
  data_limite_pagamento: string | null;
  data_pagamento: string | null;
}

/** Situação da nota em `hoje` ("aaaa-mm-dd", America/Sao_Paulo) — derivada das datas, nunca da coluna status (exceto cancelada). */
export function situacaoDaNota(nota: EstadoBasicoNota, hoje: string): SituacaoNota {
  if (nota.status === "cancelada") return "cancelada";
  if (nota.data_pagamento !== null || nota.status === "paga") return "paga";
  const diagnostico = diagnosticarNota(
    {
      temAtesto: nota.data_atesto !== null,
      temPagamento: false,
      dataEmissao: nota.data_emissao,
      dataAtesto: nota.data_atesto,
      dataLimitePagamento: nota.data_limite_pagamento ?? (nota.data_atesto ? somarDias(nota.data_atesto, PRAZO_PAGAMENTO_DIAS) : null)
    },
    new Date(`${hoje}T00:00:00Z`)
  );
  return statusPersistidoDe(diagnostico.statusDerivado);
}

// --- Fases e transições ---------------------------------------------------

/** Fase = o que importa pras transições (independe da data de hoje). */
export type FaseNota = "sem_atesto" | "atestada" | "paga" | "cancelada";

export function faseDaSituacao(situacao: SituacaoNota | StatusNota): FaseNota {
  switch (situacao) {
    case "cancelada":
      return "cancelada";
    case "paga":
      return "paga";
    case "atestada":
    case "vencida":
    case "atraso_critico":
      return "atestada";
    default:
      return "sem_atesto"; // aguardando_atesto e o legado "emitida"
  }
}

export function faseDaNota(nota: Pick<EstadoBasicoNota, "status" | "data_atesto" | "data_pagamento">): FaseNota {
  if (nota.status === "cancelada") return "cancelada";
  if (nota.data_pagamento !== null || nota.status === "paga") return "paga";
  if (nota.data_atesto !== null) return "atestada";
  return "sem_atesto";
}

export type AcaoNota = "registrar_atesto" | "registrar_pagamento" | "cancelar" | "reabrir_pagamento";

/**
 * De que fase cada ação pode partir. REGRA DE NEGÓCIO DOCUMENTADA:
 * pagamento só depois do atesto — Lei 14.133/2021, Art. 141: o prazo de
 * pagamento conta a partir da liquidação/atesto, e sem atesto não existe
 * data-limite pra medir atraso. Se a prefeitura pagou sem o atesto estar
 * registrado aqui, registre o atesto primeiro (pode ser na mesma data).
 * Cancelar: só nota em aberto (paga precisa ter o pagamento reaberto
 * antes). Cancelada é terminal.
 */
const FASES_DE_ORIGEM: Record<AcaoNota, readonly FaseNota[]> = {
  registrar_atesto: ["sem_atesto"],
  registrar_pagamento: ["atestada"],
  cancelar: ["sem_atesto", "atestada"],
  reabrir_pagamento: ["paga"]
};

const MOTIVO_RECUSA: Record<AcaoNota, Partial<Record<FaseNota, string>>> = {
  registrar_atesto: {
    atestada: "O atesto desta nota já foi registrado.",
    paga: "Esta nota já está paga.",
    cancelada: "Esta nota está cancelada."
  },
  registrar_pagamento: {
    sem_atesto: "Registre o atesto antes do pagamento (o prazo legal de pagamento conta a partir do atesto).",
    paga: "O pagamento desta nota já foi registrado.",
    cancelada: "Não é possível pagar uma nota cancelada."
  },
  cancelar: {
    paga: "Não é possível cancelar uma nota paga — reabra o pagamento antes, se ele foi registrado por engano.",
    cancelada: "Esta nota já está cancelada."
  },
  reabrir_pagamento: {
    sem_atesto: "Esta nota não tem pagamento registrado.",
    atestada: "Esta nota não tem pagamento registrado.",
    cancelada: "Esta nota está cancelada."
  }
};

export type ResultadoTransicao = { ok: true } | { ok: false; erro: string };

export function validarTransicao(fase: FaseNota, acao: AcaoNota): ResultadoTransicao {
  if (FASES_DE_ORIGEM[acao].includes(fase)) return { ok: true };
  return { ok: false, erro: MOTIVO_RECUSA[acao][fase] ?? "Ação não permitida no estado atual da nota." };
}

/** Ações possíveis a partir de uma fase (pra UI mostrar só os botões válidos). */
export function acoesPermitidas(fase: FaseNota): AcaoNota[] {
  return (Object.keys(FASES_DE_ORIGEM) as AcaoNota[]).filter((acao) => FASES_DE_ORIGEM[acao].includes(fase));
}

/**
 * Status a gravar DEPOIS da ação — já derivado pela data de hoje (um
 * atesto retroativo de 90 dias já nasce "atraso_critico", sem esperar o
 * job diário).
 */
export function statusAposAcao(nota: EstadoBasicoNota, acao: AcaoNota, dataEvento: string | null, hoje: string): SituacaoNota {
  switch (acao) {
    case "registrar_atesto":
      return situacaoDaNota({ ...nota, status: "atestada", data_atesto: dataEvento, data_limite_pagamento: null }, hoje);
    case "registrar_pagamento":
      return "paga";
    case "cancelar":
      return "cancelada";
    case "reabrir_pagamento":
      return situacaoDaNota({ ...nota, status: "atestada", data_pagamento: null }, hoje);
  }
}

// --- Datas ----------------------------------------------------------------

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DATA_MINIMA = "2000-01-01";

/** "aaaa-mm-dd" que existe de verdade no calendário (2026-02-30 → false). */
export function dataIsoValida(valor: string): boolean {
  const m = DATA_ISO.exec(valor);
  if (!m) return false;
  const data = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return data.toISOString().slice(0, 10) === valor;
}

/** Soma dias a uma data ISO em UTC (sem fuso — datas são dias civis). */
export function somarDias(dataIso: string, dias: number): string {
  const data = new Date(`${dataIso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

/**
 * Data de um evento (atesto/pagamento): ISO válida, nunca no futuro,
 * nunca antes de `minima` (emissão da nota; pro pagamento, o atesto).
 */
export function validarDataEvento(valor: string, limites: { hoje: string; minima: string; rotuloMinima: string }): string | null {
  if (!dataIsoValida(valor)) return "Data inválida — use o formato aaaa-mm-dd com uma data que exista.";
  if (valor > limites.hoje) return "A data não pode estar no futuro.";
  if (valor < limites.minima) return `A data não pode ser anterior à ${limites.rotuloMinima} (${limites.minima}).`;
  return null;
}

// --- Entrada da criação ---------------------------------------------------

/** "2026-10" ou "2026-10-17" → "2026-10-01" (competência é sempre o 1º dia do mês). null se inválida. */
export function normalizarCompetencia(valor: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(valor.trim());
  if (!m) return null;
  const primeiro = `${m[1]}-${m[2]}-01`;
  if (!dataIsoValida(primeiro)) return null;
  if (m[3] !== undefined && !dataIsoValida(`${m[1]}-${m[2]}-${m[3]}`)) return null;
  return primeiro;
}

/**
 * Competência aceitável: de 2000-01 até o mês SEGUINTE ao de hoje
 * (faturamento adiantado de um mês acontece; mais que isso é erro de
 * digitação).
 */
export function validarCompetencia(competencia: string, hoje: string): string | null {
  if (competencia < DATA_MINIMA) return "Competência anterior a 2000 — confira o ano.";
  const limite = `${somarMes(hoje.slice(0, 7) + "-01", 1)}`;
  if (competencia > limite) return "Competência mais de um mês no futuro — confira o mês.";
  return null;
}

function somarMes(primeiroDoMes: string, meses: number): string {
  const data = new Date(`${primeiroDoMes}T00:00:00Z`);
  data.setUTCMonth(data.getUTCMonth() + meses);
  return data.toISOString().slice(0, 10);
}

/** Data de emissão: ISO válida, de 2000-01-01 até hoje. */
export function validarDataEmissao(valor: string, hoje: string): string | null {
  if (!dataIsoValida(valor)) return "Data de emissão inválida — use aaaa-mm-dd com uma data que exista.";
  if (valor < DATA_MINIMA) return "Data de emissão anterior a 2000 — confira o ano.";
  if (valor > hoje) return "A data de emissão não pode estar no futuro.";
  return null;
}

// lerValorMonetario mora em lib/dinheiro.ts desde a rodada 11-A (o cadastro
// de clientes também precisa); reexportado pra quem já importava daqui.
export { lerValorMonetario } from "./dinheiro";

export const TAMANHO_MAXIMO_MOTIVO_ACAO = 300;

/** Motivo de cancelamento/reabertura: obrigatório, aparado, até 300 caracteres. */
export function lerMotivoObrigatorio(valor: unknown): { ok: true; motivo: string } | { ok: false; erro: string } {
  const motivo = typeof valor === "string" ? valor.trim() : "";
  if (motivo.length === 0) return { ok: false, erro: "Informe o motivo." };
  if (motivo.length > TAMANHO_MAXIMO_MOTIVO_ACAO) return { ok: false, erro: `Motivo muito longo — limite de ${TAMANHO_MAXIMO_MOTIVO_ACAO} caracteres.` };
  return { ok: true, motivo };
}
