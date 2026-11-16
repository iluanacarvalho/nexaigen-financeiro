// Painel financeiro gerencial da NEXAIGEN (rodada 05): quanto recebo por
// mês, quanto está atrasado, quais clientes pagam em dia, quantos
// contratos ativos. Este arquivo é só FUNÇÕES PURAS — recebe as linhas já
// lidas do banco (lib/painelFinanceiroRepositorio.ts faz a leitura) e
// "hoje", e devolve os números. Nenhuma I/O, nenhum `new Date()` escondido:
// "hoje" sempre entra como parâmetro, pelo mesmo motivo de
// lib/prazos.ts#diagnosticarNota — é o que torna tudo testável sem banco.
//
// DINHEIRO EM CENTAVOS INTEIROS. `numeric` chega do driver "pg" como
// string ("4500.50" — ver lib/db.ts) e é convertido aqui por
// `paraCentavos`, que lê a string dígito a dígito (nunca
// `Number("4500.50") * 100`, que pode dar 450049.99999…). Toda soma é
// feita em inteiros (exata até 2^53 centavos ≈ R$ 90 trilhões); a divisão
// por 100 só acontece na hora de EXIBIR (formatarMoeda/CSV).
//
// DATAS: "hoje" é o dia civil em America/Sao_Paulo (`hojeEmSaoPaulo`), e
// "mês" é sempre mês civil ("2026-10"). As colunas `date` do Postgres
// chegam como string "aaaa-mm-dd" crua (ver lib/db.ts), então comparar
// mês/janela é comparação de prefixo/string, sem fuso envolvido.
//
// STATUS DE CADA NOTA EM ABERTO: derivado AQUI via
// lib/prazos.ts#diagnosticarNota na data de hoje — a MESMA função que o
// job diário usa pra gravar nota_fiscal.status. Isso dá exatamente o
// status que o cron gravaria hoje, sem a defasagem de até 24h de ler a
// coluna gravada na última execução (e sem depender do cron ter rodado).
// "Vencida"/"atraso crítico" aqui = statusDerivado "vencida"/"atraso_critico".

import { paraCentavos } from "./dinheiro";
import { LIMIAR_ATRASO_CRITICO_DIAS, diagnosticarNota } from "./prazos";
import { statusPersistidoDe, type SituacaoNota } from "./estadoNota";
import { rotuloDoPlano, temImplantacaoACobrar } from "./planos";
import { statusContratoNaData } from "./cancelamentoContrato";

/** Notas sem atesto há MAIS que isto (dias desde a emissão) entram no KPI 6. */
export const LIMIAR_PAINEL_SEM_ATESTO_DIAS = 15;
export const MESES_JANELA = 12;

export interface LinhaClientePainel {
  id: string;
  nome: string;
  uf: string;
  plano: string;
  valor_mensal: string;
  status_contrato: string;
  /** Taxa de implantação combinada (numeric em string) — ausente/null = sem implantação. */
  taxa_implantacao?: string | null;
  /** Já tem nota de implantação não cancelada (o repositório calcula com um `exists`, sem N+1). */
  tem_implantacao_ativa?: boolean;
  /** Término do aviso prévio (0011) — null/ausente sem cancelamento registrado. */
  cancelamento_termino_em?: string | null;
}

export interface LinhaNotaPainel {
  id: string;
  cliente_id: string;
  /** "mensalidade" (padrão, quando ausente) ou "implantacao" (0010). */
  tipo?: "mensalidade" | "implantacao";
  valor: string;
  competencia: string;
  status: string;
  data_emissao: string;
  data_atesto: string | null;
  data_limite_pagamento: string | null;
  data_pagamento: string | null;
}

export type SituacaoCliente = "em_dia" | "atencao" | "inadimplente";

export const ROTULO_SITUACAO: Record<SituacaoCliente, string> = {
  em_dia: "Em dia",
  atencao: "Atenção",
  inadimplente: "Inadimplente"
};

export type FaixaNotaAberta = "no_prazo" | "vencida" | "atraso_critico";

export interface ClientePainel {
  id: string;
  nome: string;
  uf: string;
  plano: string;
  /** Rótulo do plano pra exibição ("Pequeno Porte") — lib/planos.ts. */
  planoRotulo: string;
  /** Status do contrato NA DATA DE HOJE (aviso prévio com término passado já conta como encerrado — lib/cancelamentoContrato.ts). */
  statusContrato: string;
  /** Término do aviso prévio (contrato em aviso ou encerrado por ele); null sem cancelamento. */
  terminoAvisoPrevio: string | null;
  valorMensalCentavos: number;
  /** Taxa de implantação ainda SEM nota emitida (selo "Implantação a cobrar"); null = nada a cobrar. */
  implantacaoACobrarCentavos: number | null;
  notasEmAberto: number;
  valorEmAbertoCentavos: number;
  maiorAtrasoDias: number;
  situacao: SituacaoCliente;
}

export interface PontoSerieMensal {
  mes: string; // "aaaa-mm"
  faturadoCentavos: number;
  recebidoCentavos: number;
}

export interface PainelFinanceiro {
  hoje: string;
  mesCorrente: string;
  inicioJanela: string; // primeiro dia do mês mais antigo da janela de 12 meses
  semNotas: boolean;
  kpis: {
    mrr: {
      valorCentavos: number | null;
      contratos: { ativos: number; emAvisoPrevio: number; suspensos: number; encerrados: number };
    };
    /**
     * Contratos em aviso prévio (rodada 12-A): quantos e quanto do MRR sai
     * quando terminarem ("MRR em risco" — já incluído no MRR acima até o
     * término). proximoTermino: o término mais próximo (null sem nenhum).
     */
    avisoPrevio: { quantidade: number; mrrEmRiscoCentavos: number; proximoTermino: string | null };
    recebidoMesCentavos: number | null;
    aReceber: {
      totalCentavos: number;
      noPrazoCentavos: number;
      vencidasCentavos: number;
      atrasoCriticoCentavos: number;
    } | null;
    inadimplencia: { percentual: number | null; vencidoCentavos: number; faturadoCentavos: number };
    prazoMedioRecebimentoDias: number | null;
    aguardandoAtestoMais15Dias: number | null;
    /**
     * Notas EM ABERTO por situação na data de hoje (mesma derivação de
     * lib/estadoNota.ts#situacaoDaNota — a que o Dashboard, a tela de
     * Notas e o job diário usam). null sem nenhuma nota.
     */
    contagemPorSituacao: Record<Exclude<SituacaoNota, "paga" | "cancelada">, number> | null;
    /**
     * Implantação (cobrança ÚNICA, rodada 11-A) — à parte da recorrência:
     * NÃO entra no MRR; ENTRA em "recebido", "a receber" e inadimplência
     * (as notas de implantação são notas como as outras). Aqui a quebra só
     * da implantação: a cobrar (cliente ativo com taxa combinada e sem nota
     * de implantação ativa — nada emitido ainda), a receber (nota emitida
     * em aberto) e recebida (paga nos últimos 12 meses).
     */
    implantacao: {
      aCobrar: { clientes: number; centavos: number };
      aReceberCentavos: number;
      recebidaCentavos: number;
    };
  };
  serie: PontoSerieMensal[];
  clientes: ClientePainel[];
}

// --- Dinheiro -------------------------------------------------------------
// paraCentavos/formatarMoeda moraram aqui até a rodada 08; agora ficam em
// lib/dinheiro.ts (a tela de Notas também precisa, e lib/estadoNota.ts não
// pode importar este arquivo sem criar import circular). Reexportados pra
// quem já importava daqui.
export { formatarMoeda, paraCentavos } from "./dinheiro";

// --- Datas ----------------------------------------------------------------

/** Dia civil de `agora` em America/Sao_Paulo, "aaaa-mm-dd". */
export function hojeEmSaoPaulo(agora: Date): string {
  // en-CA formata como aaaa-mm-dd.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

/** Os `quantidade` meses civis terminando no mês de `hoje`, do mais antigo pro mais recente ("aaaa-mm"). */
export function mesesDaJanela(hoje: string, quantidade = MESES_JANELA): string[] {
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7)); // 1-12
  const meses: string[] = [];
  for (let i = quantidade - 1; i >= 0; i--) {
    const indice = ano * 12 + (mes - 1) - i;
    const a = Math.floor(indice / 12);
    const m = (indice % 12) + 1;
    meses.push(`${a}-${String(m).padStart(2, "0")}`);
  }
  return meses;
}

function diasEntreDatas(inicio: string, fim: string): number {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000);
}

// --- Regras ---------------------------------------------------------------

/**
 * Situação de pagamento de um cliente, pelo maior atraso entre as notas
 * em aberto (dias corridos depois de data_limite_pagamento):
 *   - Inadimplente: atraso ≥ LIMIAR_ATRASO_CRITICO_DIAS (60) — o mesmo
 *     limiar que dispara a cobrança (alerta atraso_60_dias) em lib/prazos.ts;
 *   - Atenção: qualquer atraso (1 a 59 dias);
 *   - Em dia: nenhuma nota vencida (inclui cliente sem nota em aberto).
 */
export function classificarSituacaoCliente(maiorAtrasoDias: number): SituacaoCliente {
  if (maiorAtrasoDias >= LIMIAR_ATRASO_CRITICO_DIAS) return "inadimplente";
  if (maiorAtrasoDias > 0) return "atencao";
  return "em_dia";
}

/** Paga = tem data_pagamento OU status 'paga' (a rota de verificação grava os dois juntos). */
export function notaEstaPaga(nota: LinhaNotaPainel): boolean {
  return nota.data_pagamento !== null || nota.status === "paga";
}

interface NotaAbertaDiagnosticada {
  nota: LinhaNotaPainel;
  centavos: number;
  faixa: FaixaNotaAberta;
  situacao: SituacaoNota;
  diasDeAtraso: number;
  diasSemAtesto: number | null;
}

function diagnosticarAberta(nota: LinhaNotaPainel, hoje: string): NotaAbertaDiagnosticada {
  const d = diagnosticarNota(
    {
      temAtesto: nota.data_atesto !== null,
      temPagamento: false,
      dataEmissao: nota.data_emissao,
      dataAtesto: nota.data_atesto,
      dataLimitePagamento: nota.data_limite_pagamento
    },
    new Date(`${hoje}T00:00:00Z`)
  );
  const faixa: FaixaNotaAberta = d.statusDerivado === "atraso_critico" ? "atraso_critico" : d.statusDerivado === "vencida" ? "vencida" : "no_prazo";
  return {
    nota,
    centavos: paraCentavos(nota.valor),
    faixa,
    situacao: statusPersistidoDe(d.statusDerivado),
    diasDeAtraso: Math.max(d.diasDeAtraso ?? 0, 0),
    diasSemAtesto: d.diasSemAtesto
  };
}

/**
 * MRR: soma de valor_mensal dos contratos ATIVOS e EM AVISO PRÉVIO (a
 * mensalidade continua devida até o término — rodada 12-A) + contagem por
 * status. Encerrado e suspenso não entram. Status pela data de `hoje`
 * (aviso com término passado = encerrado, mesmo antes do job diário).
 * null sem nenhum cliente.
 */
export function calcularMrr(clientes: LinhaClientePainel[], hoje: string): PainelFinanceiro["kpis"]["mrr"] {
  const contratos = { ativos: 0, emAvisoPrevio: 0, suspensos: 0, encerrados: 0 };
  let valor = 0;
  for (const c of clientes) {
    const status = statusContratoNaData(c, hoje);
    if (status === "ativo" || status === "em_aviso_previo") {
      if (status === "ativo") contratos.ativos += 1;
      else contratos.emAvisoPrevio += 1;
      valor += paraCentavos(c.valor_mensal);
    } else if (status === "suspenso") contratos.suspensos += 1;
    else if (status === "encerrado") contratos.encerrados += 1;
  }
  return { valorCentavos: clientes.length === 0 ? null : valor, contratos };
}

/** Cartão "Em aviso prévio": quantidade, MRR que sai no término e o término mais próximo. */
export function calcularAvisoPrevio(clientes: LinhaClientePainel[], hoje: string): PainelFinanceiro["kpis"]["avisoPrevio"] {
  const emAviso = clientes.filter((c) => statusContratoNaData(c, hoje) === "em_aviso_previo");
  const terminos = emAviso.map((c) => c.cancelamento_termino_em).filter((t): t is string => !!t).sort();
  return {
    quantidade: emAviso.length,
    mrrEmRiscoCentavos: emAviso.reduce((soma, c) => soma + paraCentavos(c.valor_mensal), 0),
    proximoTermino: terminos[0] ?? null
  };
}

/**
 * Inadimplência = valor vencido (vencida + atraso crítico, ainda em
 * aberto) / valor total faturado e não cancelado, AMBOS restritos às
 * notas com competência dentro da janela de 12 meses — mesma base no
 * numerador e no denominador, então o percentual nunca passa de 100%.
 * Denominador zero → percentual null (exibido "—"), nunca NaN/Infinity.
 * Percentual com 1 casa decimal.
 */
export function calcularInadimplencia(vencidoCentavos: number, faturadoCentavos: number): PainelFinanceiro["kpis"]["inadimplencia"] {
  const percentual = faturadoCentavos > 0 ? Math.round((vencidoCentavos / faturadoCentavos) * 1000) / 10 : null;
  return { percentual, vencidoCentavos, faturadoCentavos };
}

/**
 * Prazo médio de recebimento: média de dias entre data_emissao e
 * data_pagamento das notas PAGAS na janela (data_pagamento dentro dos
 * últimos 12 meses). Sem nenhuma → null. 1 casa decimal.
 */
export function calcularPrazoMedioRecebimento(notas: LinhaNotaPainel[], inicioJanela: string, hoje: string): number | null {
  const prazos = notas
    .filter((n) => n.status !== "cancelada" && n.data_pagamento !== null && n.data_pagamento >= inicioJanela && n.data_pagamento <= hoje)
    .map((n) => diasEntreDatas(n.data_emissao, n.data_pagamento!));
  if (prazos.length === 0) return null;
  return Math.round((prazos.reduce((a, b) => a + b, 0) / prazos.length) * 10) / 10;
}

/**
 * Série dos 12 meses — ESCOLHA DOCUMENTADA:
 *   - faturado: pela COMPETÊNCIA da nota (o mês de serviço a que ela se
 *     refere — é assim que o contrato mensal é faturado; data_emissao pode
 *     escorregar pro mês seguinte e distorceria o mês de origem);
 *   - recebido: pelo MÊS DE data_pagamento (caixa — quando o dinheiro
 *     entrou de fato, não a competência que ele quitou).
 * Mês sem dado = 0 na série (o gráfico precisa de todos os 12 pontos);
 * isso é diferente dos KPIs, que mostram "—" quando não há base.
 */
export function montarSerieMensal(notas: LinhaNotaPainel[], meses: string[]): PontoSerieMensal[] {
  const pontos = new Map(meses.map((mes) => [mes, { mes, faturadoCentavos: 0, recebidoCentavos: 0 }]));
  for (const n of notas) {
    if (n.status === "cancelada") continue;
    const centavos = paraCentavos(n.valor);
    const faturado = pontos.get(n.competencia.slice(0, 7));
    if (faturado) faturado.faturadoCentavos += centavos;
    if (n.data_pagamento) {
      const recebido = pontos.get(n.data_pagamento.slice(0, 7));
      if (recebido) recebido.recebidoCentavos += centavos;
    }
  }
  return meses.map((mes) => pontos.get(mes)!);
}

/** Ordem padrão da tabela: maior atraso primeiro, depois maior valor em aberto, depois nome. */
export function ordenarClientesPorAtraso(clientes: ClientePainel[], direcao: "desc" | "asc" = "desc"): ClientePainel[] {
  const fator = direcao === "desc" ? -1 : 1;
  return [...clientes].sort(
    (a, b) =>
      fator * (a.maiorAtrasoDias - b.maiorAtrasoDias) ||
      b.valorEmAbertoCentavos - a.valorEmAbertoCentavos ||
      a.nome.localeCompare(b.nome, "pt-BR")
  );
}

// --- Montagem do painel ---------------------------------------------------

/** Taxa a cobrar do cliente (regra única: lib/planos.ts#temImplantacaoACobrar), senão null. */
export function implantacaoACobrar(c: LinhaClientePainel): number | null {
  return temImplantacaoACobrar(c) ? paraCentavos(c.taxa_implantacao!) : null;
}

export function montarPainelFinanceiro(entrada: { clientes: LinhaClientePainel[]; notas: LinhaNotaPainel[]; hoje: string }): PainelFinanceiro {
  const { clientes, hoje } = entrada;
  const notas = entrada.notas.filter((n) => n.status !== "cancelada");
  const meses = mesesDaJanela(hoje);
  const inicioJanela = `${meses[0]}-01`;
  const mesCorrente = meses[meses.length - 1];
  const dentroDaJanela = (n: LinhaNotaPainel) => n.competencia >= inicioJanela && n.competencia.slice(0, 7) <= mesCorrente;

  const abertas = notas.filter((n) => !notaEstaPaga(n)).map((n) => diagnosticarAberta(n, hoje));
  const semNotas = notas.length === 0;

  const aReceber = { totalCentavos: 0, noPrazoCentavos: 0, vencidasCentavos: 0, atrasoCriticoCentavos: 0 };
  let vencidoNaJanela = 0;
  let aguardandoAtesto = 0;
  const contagemPorSituacao = { aguardando_atesto: 0, atestada: 0, vencida: 0, atraso_critico: 0 };
  for (const a of abertas) {
    if (a.situacao !== "paga" && a.situacao !== "cancelada") contagemPorSituacao[a.situacao] += 1;
    aReceber.totalCentavos += a.centavos;
    if (a.faixa === "atraso_critico") aReceber.atrasoCriticoCentavos += a.centavos;
    else if (a.faixa === "vencida") aReceber.vencidasCentavos += a.centavos;
    else aReceber.noPrazoCentavos += a.centavos;
    if (a.faixa !== "no_prazo" && dentroDaJanela(a.nota)) vencidoNaJanela += a.centavos;
    if (a.nota.data_atesto === null && (a.diasSemAtesto ?? 0) > LIMIAR_PAINEL_SEM_ATESTO_DIAS) aguardandoAtesto += 1;
  }

  const faturadoNaJanela = notas.filter(dentroDaJanela).reduce((soma, n) => soma + paraCentavos(n.valor), 0);
  const recebidoMes = notas
    .filter((n) => n.data_pagamento !== null && n.data_pagamento.slice(0, 7) === mesCorrente)
    .reduce((soma, n) => soma + paraCentavos(n.valor), 0);

  const abertasPorCliente = new Map<string, NotaAbertaDiagnosticada[]>();
  for (const a of abertas) {
    const lista = abertasPorCliente.get(a.nota.cliente_id) ?? [];
    lista.push(a);
    abertasPorCliente.set(a.nota.cliente_id, lista);
  }

  // Encerrado continua na tabela: a situação financeira vem das notas em aberto, que seguem exigíveis.
  const linhasClientes: ClientePainel[] = clientes.map((c) => {
    const doCliente = abertasPorCliente.get(c.id) ?? [];
    const maiorAtrasoDias = doCliente.reduce((max, a) => Math.max(max, a.diasDeAtraso), 0);
    const statusContrato = statusContratoNaData(c, hoje);
    return {
      id: c.id,
      nome: c.nome,
      uf: c.uf,
      plano: c.plano,
      planoRotulo: rotuloDoPlano(c.plano),
      statusContrato,
      terminoAvisoPrevio: c.cancelamento_termino_em ?? null,
      valorMensalCentavos: paraCentavos(c.valor_mensal),
      implantacaoACobrarCentavos: implantacaoACobrar({ ...c, status_contrato: statusContrato }),
      notasEmAberto: doCliente.length,
      valorEmAbertoCentavos: doCliente.reduce((soma, a) => soma + a.centavos, 0),
      maiorAtrasoDias,
      situacao: classificarSituacaoCliente(maiorAtrasoDias)
    };
  });

  return {
    hoje,
    mesCorrente,
    inicioJanela,
    semNotas,
    kpis: {
      mrr: calcularMrr(clientes, hoje),
      avisoPrevio: calcularAvisoPrevio(clientes, hoje),
      recebidoMesCentavos: semNotas ? null : recebidoMes,
      aReceber: semNotas ? null : aReceber,
      inadimplencia: calcularInadimplencia(vencidoNaJanela, faturadoNaJanela),
      prazoMedioRecebimentoDias: calcularPrazoMedioRecebimento(notas, inicioJanela, hoje),
      aguardandoAtestoMais15Dias: semNotas ? null : aguardandoAtesto,
      contagemPorSituacao: semNotas ? null : contagemPorSituacao,
      implantacao: {
        aCobrar: linhasClientes.reduce(
          (t, c) => (c.implantacaoACobrarCentavos === null ? t : { clientes: t.clientes + 1, centavos: t.centavos + c.implantacaoACobrarCentavos }),
          { clientes: 0, centavos: 0 }
        ),
        aReceberCentavos: abertas.filter((a) => a.nota.tipo === "implantacao").reduce((soma, a) => soma + a.centavos, 0),
        recebidaCentavos: notas
          .filter((n) => n.tipo === "implantacao" && n.data_pagamento !== null && n.data_pagamento >= inicioJanela && n.data_pagamento <= hoje)
          .reduce((soma, n) => soma + paraCentavos(n.valor), 0)
      }
    },
    serie: montarSerieMensal(notas, meses),
    clientes: ordenarClientesPorAtraso(linhasClientes)
  };
}

// --- CSV ------------------------------------------------------------------

const INICIO_FORMULA = /^[=+\-@\t\r]/;

/**
 * Neutraliza injeção de fórmula (CSV injection): texto que começa com
 * = + - @ TAB ou CR ganha um apóstrofo na frente, e a planilha passa a
 * tratá-lo como texto literal. Aplicado SÓ a células de texto — número
 * formatado por nós mesmos não passa por aqui.
 */
export function neutralizarFormula(texto: string): string {
  return INICIO_FORMULA.test(texto) ? `'${texto}` : texto;
}

function celulaTexto(texto: string): string {
  return celula(neutralizarFormula(texto));
}

/** Aspas quando necessário (separador, aspas, quebra de linha), aspas internas duplicadas. */
function celula(valor: string): string {
  return /[;"\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

/** Centavos → "4500,50" (vírgula decimal, sem separador de milhar — abre como número no Excel pt-BR). */
function centavosCsv(centavos: number): string {
  const sinal = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sinal}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/**
 * CSV da tabela de clientes: BOM UTF-8 (Excel reconhece os acentos),
 * separador ";" (padrão do Excel em pt-BR, onde "," é a vírgula decimal),
 * CRLF. Sem nenhum dado de contato (e-mail/telefone) — de propósito.
 */
export function gerarCsvClientes(clientes: ClientePainel[]): string {
  const cabecalho = ["Cliente", "UF", "Plano", "Valor mensal (R$)", "Notas em aberto", "Valor em aberto (R$)", "Maior atraso (dias)", "Situação"];
  const linhas = clientes.map((c) =>
    [
      celulaTexto(c.nome),
      celulaTexto(c.uf),
      celulaTexto(c.planoRotulo),
      centavosCsv(c.valorMensalCentavos),
      String(c.notasEmAberto),
      centavosCsv(c.valorEmAbertoCentavos),
      String(c.maiorAtrasoDias),
      celulaTexto(ROTULO_SITUACAO[c.situacao])
    ].join(";")
  );
  return "﻿" + [cabecalho.join(";"), ...linhas].join("\r\n") + "\r\n";
}
