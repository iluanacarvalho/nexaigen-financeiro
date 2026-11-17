// Relatório "Novos contratos" por mês (rodada 15-A) — FUNÇÕES PURAS: recebe
// as linhas já lidas do banco (lib/relatorioContratosRepositorio.ts) e
// "hoje", devolve os números. Testado em lib/relatorioContratos.test.ts.
//
// REGRA DE NEGÓCIO: a vigência do contrato começa na ASSINATURA — então
// cliente_prefeitura.data_inicio_contrato É a data de assinatura, e um
// contrato é "novo no mês M" quando data_inicio_contrato cai dentro de M.
//
// DATAS: meses civis ("aaaa-mm"). O mês atual e "hoje" vêm do relógio em
// America/Sao_Paulo (lib/painelFinanceiro.ts#hojeEmSaoPaulo) — às 23h de
// 31/12 em Brasília ainda é dezembro, mesmo já sendo janeiro em UTC.
// Colunas `date` chegam como "aaaa-mm-dd" cru (lib/db.ts): comparar com os
// limites do mês é comparação de texto, sem fuso.
//
// DINHEIRO em centavos inteiros (lib/dinheiro.ts#paraCentavos). O MRR é o
// valor_mensal combinado ATUAL de cada contrato (a mesma coluna e a mesma
// conversão do Painel); "MRR da carteira hoje" é literalmente
// lib/painelFinanceiro.ts#calcularMrr — bate com o Painel por construção.
//
// ENCERRADOS / AVISO PRÉVIO vêm da trilha cliente_evento_contrato (0011):
//   - encerrado no mês = evento 'contrato_encerrado' com data no mês;
//   - em aviso prévio no fim do mês = o último evento até o fim do mês
//     (ou até hoje, no mês atual) é 'cancelamento_registrado' e o término
//     (pedido + 30) ainda não passou nessa data.
// Encerramentos anteriores à trilha (0011) não têm evento e não entram.

import { paraCentavos } from "./dinheiro";
import { AVISO_PREVIO_DIAS, statusContratoNaData } from "./cancelamentoContrato";
import { somarDias } from "./estadoNota";
import { calcularMrr, implantacaoACobrar, mesesDaJanela, type LinhaClientePainel } from "./painelFinanceiro";
import { rotuloDoPlano } from "./planos";

export const MESES_SERIE = 12;
export const MES_MINIMO = "2000-01";

// --- Meses --------------------------------------------------------------------

/** "2026-02" → { inicio: "2026-02-01", fim: "2026-02-28" } (bissexto respeitado). */
export function limitesDoMes(mes: string): { inicio: string; fim: string } {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimoDia).padStart(2, "0")}` };
}

/** Mês anterior ("2026-01" → "2025-12"). */
export function mesAnterior(mes: string): string {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return m === 1 ? `${ano - 1}-12` : `${ano}-${String(m - 1).padStart(2, "0")}`;
}

/** "2026-11" → "11/2026". */
export function rotuloMes(mes: string): string {
  return `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;
}

/** Mês válido pro relatório: "aaaa-mm" real, de 2000-01 até o mês atual (relatório do futuro não existe). null = ok. */
export function validarMes(mes: string, mesAtual: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return "Mês inválido — use aaaa-mm.";
  if (mes < MES_MINIMO) return "Mês anterior a 2000 — confira o ano.";
  if (mes > mesAtual) return "Esse mês ainda não chegou.";
  return null;
}

// --- Variação -------------------------------------------------------------------

export interface Variacao {
  absoluta: number;
  /** null quando o mês anterior é zero (sem base — a tela mostra "—", nunca divide por zero). 1 casa decimal. */
  percentual: number | null;
}

export function variacao(atual: number, anterior: number): Variacao {
  return { absoluta: atual - anterior, percentual: anterior === 0 ? null : Math.round(((atual - anterior) / anterior) * 1000) / 10 };
}

// --- Entrada / saída ----------------------------------------------------------------

export interface LinhaClienteRelatorio extends LinhaClientePainel {
  data_inicio_contrato: string;
  municipio_id_externo: string | null;
}

export interface LinhaEventoContrato {
  cliente_id: string;
  tipo: "cancelamento_registrado" | "cancelamento_retratado" | "contrato_encerrado";
  data_evento: string;
  criado_em: string;
}

/** De onde o contrato veio: cadastro manual na tela (painel) ou integração com o nexaigen-educa. */
export type OrigemContrato = "painel" | "educa";

export const ROTULO_ORIGEM: Record<OrigemContrato, string> = { painel: "Cadastro manual", educa: "Integração Educa" };

export function origemDoContrato(c: { municipio_id_externo: string | null }): OrigemContrato {
  return c.municipio_id_externo ? "educa" : "painel";
}

export interface ContratoNovo {
  id: string;
  nome: string;
  uf: string;
  plano: string;
  planoRotulo: string;
  valorMensalCentavos: number;
  taxaImplantacaoCentavos: number | null;
  dataInicio: string;
  /** Status na data de hoje (aviso com término passado = encerrado — lib/cancelamentoContrato.ts). */
  statusContrato: string;
  origem: OrigemContrato;
}

export interface QuantidadeMrr {
  quantidade: number;
  mrrCentavos: number;
}

export interface PontoSerieContratos {
  mes: string;
  novos: number;
  mrrNovoCentavos: number;
  /** Soma do MRR novo desde o primeiro mês da janela de 12 meses até este. */
  mrrNovoAcumuladoCentavos: number;
}

export interface RelatorioContratos {
  mes: string;
  mesAnterior: string;
  hoje: string;
  /** Data de corte pro "em aviso prévio": fim do mês, ou hoje no mês atual. */
  dataReferencia: string;
  semContratos: boolean;
  novos: QuantidadeMrr & { implantacaoACobrarCentavos: number };
  anterior: QuantidadeMrr;
  variacao: { quantidade: Variacao; mrr: Variacao };
  encerrados: QuantidadeMrr;
  emAvisoPrevio: QuantidadeMrr;
  /** novos − encerrados (quantidade e MRR). */
  saldoLiquido: QuantidadeMrr;
  /** MRR da carteira inteira hoje — a MESMA conta do Painel (calcularMrr). null sem nenhum cliente. */
  mrrCarteiraHojeCentavos: number | null;
  contratos: ContratoNovo[];
  serie: PontoSerieContratos[];
}

// --- Regras -------------------------------------------------------------------------

function noMes(data: string, mes: string): boolean {
  return data.slice(0, 7) === mes;
}

function somaMrr(clientes: LinhaClienteRelatorio[]): QuantidadeMrr {
  return { quantidade: clientes.length, mrrCentavos: clientes.reduce((s, c) => s + paraCentavos(c.valor_mensal), 0) };
}

const ORDEM_EVENTO = (a: LinhaEventoContrato, b: LinhaEventoContrato) =>
  a.data_evento.localeCompare(b.data_evento) || a.criado_em.localeCompare(b.criado_em);

/** Clientes com encerramento registrado (evento) dentro do mês. */
export function encerradosNoMes(eventos: LinhaEventoContrato[], mes: string): Set<string> {
  return new Set(eventos.filter((e) => e.tipo === "contrato_encerrado" && noMes(e.data_evento, mes)).map((e) => e.cliente_id));
}

/**
 * Clientes em aviso prévio em `data`: o último evento até `data` é o
 * registro do cancelamento e o término (pedido + 30) ainda não passou —
 * o dia do término ainda é de contrato (mesma regra do job diário).
 */
export function emAvisoPrevioNaData(eventos: LinhaEventoContrato[], data: string): Set<string> {
  const ultimo = new Map<string, LinhaEventoContrato>();
  for (const e of [...eventos].sort(ORDEM_EVENTO)) if (e.data_evento <= data) ultimo.set(e.cliente_id, e);
  const ids = new Set<string>();
  for (const [id, e] of ultimo) if (e.tipo === "cancelamento_registrado" && somarDias(e.data_evento, AVISO_PREVIO_DIAS) >= data) ids.add(id);
  return ids;
}

export function montarRelatorioContratos(entrada: { clientes: LinhaClienteRelatorio[]; eventos: LinhaEventoContrato[]; mes: string; hoje: string }): RelatorioContratos {
  const { clientes, eventos, mes, hoje } = entrada;
  const anteriorMes = mesAnterior(mes);
  const { fim } = limitesDoMes(mes);
  const dataReferencia = fim < hoje ? fim : hoje;

  const novosDoMes = clientes.filter((c) => noMes(c.data_inicio_contrato, mes));
  const novosAnterior = somaMrr(clientes.filter((c) => noMes(c.data_inicio_contrato, anteriorMes)));
  const novos = somaMrr(novosDoMes);
  const implantacao = novosDoMes.reduce((s, c) => s + (implantacaoACobrar({ ...c, status_contrato: statusContratoNaData(c, hoje) }) ?? 0), 0);

  const porId = new Map(clientes.map((c) => [c.id, c]));
  const doConjunto = (ids: Set<string>) => somaMrr([...ids].map((id) => porId.get(id)).filter((c): c is LinhaClienteRelatorio => !!c));
  const encerrados = doConjunto(encerradosNoMes(eventos, mes));
  const emAvisoPrevio = doConjunto(emAvisoPrevioNaData(eventos, dataReferencia));

  let acumulado = 0;
  const serie = mesesDaJanela(`${mes}-01`, MESES_SERIE).map((m) => {
    const doMes = somaMrr(clientes.filter((c) => noMes(c.data_inicio_contrato, m)));
    acumulado += doMes.mrrCentavos;
    return { mes: m, novos: doMes.quantidade, mrrNovoCentavos: doMes.mrrCentavos, mrrNovoAcumuladoCentavos: acumulado };
  });

  const contratos: ContratoNovo[] = novosDoMes
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      uf: c.uf,
      plano: c.plano,
      planoRotulo: rotuloDoPlano(c.plano),
      valorMensalCentavos: paraCentavos(c.valor_mensal),
      taxaImplantacaoCentavos: c.taxa_implantacao ? paraCentavos(c.taxa_implantacao) : null,
      dataInicio: c.data_inicio_contrato,
      statusContrato: statusContratoNaData(c, hoje),
      origem: origemDoContrato(c)
    }))
    .sort((a, b) => a.dataInicio.localeCompare(b.dataInicio) || a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    mes,
    mesAnterior: anteriorMes,
    hoje,
    dataReferencia,
    semContratos: novos.quantidade === 0,
    novos: { ...novos, implantacaoACobrarCentavos: implantacao },
    anterior: novosAnterior,
    variacao: { quantidade: variacao(novos.quantidade, novosAnterior.quantidade), mrr: variacao(novos.mrrCentavos, novosAnterior.mrrCentavos) },
    encerrados,
    emAvisoPrevio,
    saldoLiquido: { quantidade: novos.quantidade - encerrados.quantidade, mrrCentavos: novos.mrrCentavos - encerrados.mrrCentavos },
    mrrCarteiraHojeCentavos: calcularMrr(clientes, hoje).valorCentavos,
    contratos,
    serie
  };
}
