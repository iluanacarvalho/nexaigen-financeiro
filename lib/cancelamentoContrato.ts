// Cancelamento de contrato com aviso prévio (rodada 12-A) — FUNÇÕES PURAS
// (sem banco, "hoje" sempre como parâmetro), testadas em
// lib/cancelamentoContrato.test.ts. A escrita transacional que aplica estas
// regras é lib/cancelamentoServico.ts; o banco garante a coerência com os
// CHECKs da migration 0011.
//
// REGRAS (Luana):
//   - aviso prévio FIXO de 30 dias corridos, contados da data de
//     RECEBIMENTO do ofício. Término = pedido + 30 dias. O dia do término
//     ainda é dia de contrato (a mensalidade é devida ATÉ o término): o
//     contrato só vira 'encerrado' no dia SEGUINTE (`termino < hoje`), e a
//     retratação vale até o próprio dia do término (`hoje <= termino`);
//   - o cancelamento NÃO cancela dívida já emitida (notas continuam
//     exigíveis e cobradas — isso é do job diário, não daqui);
//   - última nota proporcional: valor_mensal × dias ÷ 30, arredondado ao
//     centavo (meio pra cima), sempre em CENTAVOS INTEIROS.
//
// PERÍODOS: blocos de 30 dias corridos contados de data_inicio_contrato
// (período 0 = início .. início+29, período 1 = início+30 .. início+59, …).
// A nota de mensalidade, porém, é lançada por COMPETÊNCIA (1º dia do mês,
// lib/estadoNota.ts) — a competência de um período é o mês em que ele
// COMEÇA. "Período que começa depois do término" = competência posterior à
// competência do último período (o próximo período sempre começa depois
// do término).

import { dataIsoValida, somarDias } from "./estadoNota";

export const AVISO_PREVIO_DIAS = 30;
export const DIAS_DO_PERIODO = 30;
export const TAMANHO_MAXIMO_MOTIVO_CANCELAMENTO = 500;

/**
 * 'aguardando_assinatura' (rodada 16-B1): PRÉ-contrato — cliente criado no
 * aceite, ainda sem assinatura. SEM vigência e SEM cobrança: sem
 * data_inicio_contrato, fora de MRR, notas, alertas e mapa público. Vira
 * 'ativo' só quando a assinatura é registrada (lib/fechamentoServico.ts).
 */
export type StatusContrato = "aguardando_assinatura" | "ativo" | "em_aviso_previo" | "suspenso" | "encerrado";

/** Ordem do contrato "mais vivo" pro menos (o Território escolhe o primeiro vigente nesta ordem). */
export const STATUS_CONTRATO: readonly StatusContrato[] = ["ativo", "em_aviso_previo", "suspenso", "aguardando_assinatura", "encerrado"];

export const ROTULO_STATUS_CONTRATO: Record<StatusContrato, string> = {
  aguardando_assinatura: "Aguardando assinatura",
  ativo: "Ativo",
  em_aviso_previo: "Em aviso prévio",
  suspenso: "Suspenso",
  encerrado: "Encerrado"
};

/** Cliente do fechamento que ainda não assinou: sem vigência, sem cobrança (16-B1). */
export function aguardandoAssinatura(c: { status_contrato: string }): boolean {
  return c.status_contrato === "aguardando_assinatura";
}

/** Rótulo em português; status desconhecido aparece como veio (nunca quebra uma tela). */
export function rotuloStatusContrato(status: string): string {
  return ROTULO_STATUS_CONTRATO[status as StatusContrato] ?? status;
}

// --- Datas ----------------------------------------------------------------

/** Dias corridos de `inicio` até `fim` (fim − início; negativo se fim é antes). */
export function diasEntre(inicio: string, fim: string): number {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000);
}

/** "2026-10-31" → "31/10/2026". */
export function formatarDataBr(iso: string): string {
  return iso.split("-").reverse().join("/");
}

/** Término do contrato: data do pedido (recebimento do ofício) + 30 dias. */
export function calcularTermino(dataPedido: string): string {
  return somarDias(dataPedido, AVISO_PREVIO_DIAS);
}

// --- Validações -----------------------------------------------------------

export type MotivoRecusa = "dados_invalidos" | "transicao_invalida";
export type Validacao<T> = ({ ok: true } & T) | { ok: false; motivo: MotivoRecusa; erro: string };

/**
 * Registrar o cancelamento: data ISO real, nunca no futuro, nunca antes do
 * início do contrato, e só de contrato 'ativo' (em aviso, suspenso ou
 * encerrado → transição inválida, 409).
 */
export function validarPedido(entrada: {
  dataPedido: string;
  hoje: string;
  dataInicioContrato: string;
  statusContrato: string;
}): Validacao<{ termino: string }> {
  if (entrada.statusContrato !== "ativo") {
    return {
      ok: false,
      motivo: "transicao_invalida",
      erro:
        entrada.statusContrato === "em_aviso_previo"
          ? "Este contrato já está em aviso prévio — retrate o cancelamento atual antes de registrar outro."
          : `Só é possível registrar cancelamento de contrato ativo (este está ${rotuloStatusContrato(entrada.statusContrato).toLowerCase()}).`
    };
  }
  if (!dataIsoValida(entrada.dataPedido)) {
    return { ok: false, motivo: "dados_invalidos", erro: "Data do ofício inválida — use aaaa-mm-dd com uma data que exista." };
  }
  if (entrada.dataPedido > entrada.hoje) {
    return { ok: false, motivo: "dados_invalidos", erro: "A data de recebimento do ofício não pode estar no futuro." };
  }
  if (entrada.dataPedido < entrada.dataInicioContrato) {
    return {
      ok: false,
      motivo: "dados_invalidos",
      erro: `A data do ofício não pode ser anterior ao início do contrato (${formatarDataBr(entrada.dataInicioContrato)}).`
    };
  }
  return { ok: true, termino: calcularTermino(entrada.dataPedido) };
}

/** Retratar: só em aviso prévio e até a data de término (inclusive). */
export function validarRetratacao(entrada: { statusContrato: string; termino: string | null; hoje: string }): Validacao<object> {
  if (entrada.statusContrato !== "em_aviso_previo" || entrada.termino === null) {
    return { ok: false, motivo: "transicao_invalida", erro: "Este contrato não está em aviso prévio — não há cancelamento a retratar." };
  }
  if (entrada.hoje > entrada.termino) {
    return {
      ok: false,
      motivo: "transicao_invalida",
      erro: `O aviso prévio terminou em ${formatarDataBr(entrada.termino)} — a retratação só é possível até a data de término.`
    };
  }
  return { ok: true };
}

/** Motivo do cancelamento: aparado; vazio → null; até 500 caracteres. */
export function lerMotivoCancelamento(valor: string | undefined | null): { ok: true; motivo: string | null } | { ok: false; erro: string } {
  const motivo = (valor ?? "").trim();
  if (motivo.length > TAMANHO_MAXIMO_MOTIVO_CANCELAMENTO) {
    return { ok: false, erro: `Motivo muito longo — limite de ${TAMANHO_MAXIMO_MOTIVO_CANCELAMENTO} caracteres.` };
  }
  return { ok: true, motivo: motivo === "" ? null : motivo };
}

/** O aviso prévio já acabou (o dia do término já passou)? Então o contrato deve estar encerrado. */
export function avisoPrevioVencido(termino: string, hoje: string): boolean {
  return termino < hoje;
}

/**
 * Status do contrato NA DATA DE HOJE: 'em_aviso_previo' com o término já
 * passado conta como 'encerrado' mesmo antes do job diário gravar a
 * mudança (mesma ideia de lib/estadoNota.ts#situacaoDaNota — o Painel não
 * depende do cron ter rodado).
 */
export function statusContratoNaData(c: { status_contrato: string; cancelamento_termino_em?: string | null }, hoje: string): string {
  if (c.status_contrato === "em_aviso_previo" && c.cancelamento_termino_em && avisoPrevioVencido(c.cancelamento_termino_em, hoje)) {
    return "encerrado";
  }
  return c.status_contrato;
}

// --- Períodos e nota final ------------------------------------------------

export interface Periodo {
  /** 0 = primeiro período do contrato. */
  numero: number;
  inicio: string;
  fim: string;
}

/** O período de 30 dias (contados de `inicioContrato`) que contém `data`. */
export function periodoQueContem(inicioContrato: string, data: string): Periodo {
  const dias = diasEntre(inicioContrato, data);
  if (dias < 0) throw new Error(`Data ${data} anterior ao início do contrato (${inicioContrato}).`);
  const numero = Math.floor(dias / DIAS_DO_PERIODO);
  const inicio = somarDias(inicioContrato, numero * DIAS_DO_PERIODO);
  return { numero, inicio, fim: somarDias(inicio, DIAS_DO_PERIODO - 1) };
}

/** Último período cobrável: o que contém a data de término. */
export function ultimoPeriodo(inicioContrato: string, termino: string): Periodo {
  return periodoQueContem(inicioContrato, termino);
}

/** Dias cobrados no último período: término − início do período + 1, limitado a 1..30. */
export function diasDoUltimoPeriodo(inicioContrato: string, termino: string): number {
  const dias = diasEntre(ultimoPeriodo(inicioContrato, termino).inicio, termino) + 1;
  return Math.min(DIAS_DO_PERIODO, Math.max(1, dias));
}

/**
 * Valor da nota final: valorMensal × dias ÷ 30, arredondado ao centavo
 * (meio pra cima) — só aritmética INTEIRA (nunca float): round(N/30) =
 * floor((N + 15) / 30), com a divisão exata feita depois de tirar o resto.
 */
export function valorNotaFinalCentavos(valorMensalCentavos: number, inicioContrato: string, termino: string): number {
  if (!Number.isSafeInteger(valorMensalCentavos) || valorMensalCentavos < 0) throw new Error("valor mensal precisa ser centavos inteiros.");
  const n = valorMensalCentavos * diasDoUltimoPeriodo(inicioContrato, termino) + DIAS_DO_PERIODO / 2;
  return (n - (n % DIAS_DO_PERIODO)) / DIAS_DO_PERIODO;
}

/** Competência (1º dia do mês) de um período: o mês em que ele começa. */
export function competenciaDoPeriodo(periodo: Periodo): string {
  return `${periodo.inicio.slice(0, 7)}-01`;
}

/** Competência da nota final (a do último período). */
export function competenciaNotaFinal(inicioContrato: string, termino: string): string {
  return competenciaDoPeriodo(ultimoPeriodo(inicioContrato, termino));
}

/** Mensalidade de `competencia` é de um período que começa DEPOIS do término? (→ 409) */
export function competenciaAposTermino(competencia: string, inicioContrato: string, termino: string): boolean {
  return competencia > competenciaNotaFinal(inicioContrato, termino);
}

export interface NotaFinalSugerida {
  competencia: string;
  periodo: Periodo;
  dias: number;
  valorCentavos: number;
}

/** Tudo o que o formulário de "nota final" precisa pré-preencher. */
export function sugerirNotaFinal(c: { data_inicio_contrato: string; cancelamento_termino_em: string; valorMensalCentavos: number }): NotaFinalSugerida {
  const periodo = ultimoPeriodo(c.data_inicio_contrato, c.cancelamento_termino_em);
  return {
    competencia: competenciaDoPeriodo(periodo),
    periodo,
    dias: diasDoUltimoPeriodo(c.data_inicio_contrato, c.cancelamento_termino_em),
    valorCentavos: valorNotaFinalCentavos(c.valorMensalCentavos, c.data_inicio_contrato, c.cancelamento_termino_em)
  };
}

/**
 * Cliente que ainda pode receber nota de MENSALIDADE: ativo, em aviso
 * prévio, ou encerrado POR ESTE FLUXO (tem término registrado — é o que
 * permite emitir a nota final mesmo se o job diário já encerrou o
 * contrato). Suspenso e encerrado sem término não. A competência ainda
 * passa por competenciaAposTermino.
 */
export function aceitaMensalidade(c: { status_contrato: string; cancelamento_termino_em?: string | null }): boolean {
  if (c.status_contrato === "ativo" || c.status_contrato === "em_aviso_previo") return true;
  return c.status_contrato === "encerrado" && !!c.cancelamento_termino_em;
}

/** Mostrar o aviso de "nota final" (contrato com término registrado e sem nota do último período)? */
export function precisaNotaFinal(c: { status_contrato: string; cancelamento_termino_em?: string | null; nota_final_emitida?: boolean }): boolean {
  return (c.status_contrato === "em_aviso_previo" || c.status_contrato === "encerrado") && !!c.cancelamento_termino_em && !c.nota_final_emitida;
}
