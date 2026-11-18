// Exportação CSV e XLSX do relatório de novos contratos (rodada 15-A) — os
// MESMOS dados da tela (lib/relatorioContratos.ts#montarRelatorioContratos):
// cabeçalho "NEXAIGEN — Relatório de novos contratos" + mês + data de
// geração, o resumo (cartões) e a tabela do mês. CSV: BOM, separador ";",
// CRLF, vírgula decimal. Texto de dado (nome, UF…) sempre passa por
// neutralizarFormula (lib/exportacao.ts) — nos dois formatos. Nenhum dado
// de contato. Funções puras.

import { centavosParaNumeric } from "./dinheiro";
import { celulaTextoCsv, centavosCsv, formatarGeradoEm, montarCsv, neutralizarFormula } from "./exportacao";
import { rotuloStatusContrato } from "./cancelamentoContrato";
import { ROTULO_ORIGEM, rotuloMes, type RelatorioContratos, type Variacao } from "./relatorioContratos";
import { gerarXlsx, type CelulaXlsx } from "./xlsx";

export const TITULO_RELATORIO = "NEXAIGEN — Relatório de novos contratos";

const COLUNAS = ["Prefeitura", "UF", "Plano", "Valor mensal (R$)", "Taxa de implantação (R$)", "Início do contrato (assinatura)", "Status do contrato", "Origem"];

// formatarGeradoEm mora em lib/exportacao.ts desde a rodada 16-A (a exportação do CRM usa a mesma); reexportada.
export { formatarGeradoEm } from "./exportacao";

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/** Variação em texto: "+2 (+50%)", "-1 (—)" quando o mês anterior não tem base. */
export function textoVariacao(v: Variacao, formatar: (n: number) => string = String): string {
  const sinal = v.absoluta > 0 ? "+" : "";
  const pct = v.percentual === null ? "—" : `${v.percentual > 0 ? "+" : ""}${String(v.percentual).replace(".", ",")}%`;
  return `${sinal}${formatar(v.absoluta)} (${pct})`;
}

// Variação vai em células NUMÉRICAS (absoluta e %): um texto "+1 (+50%)" começaria com "+" e a planilha
// o leria como fórmula (ou exibiria com o apóstrofo da neutralização).
type Valor = { texto: string } | { centavos: number } | { inteiro: number } | { percentual: number };

/** Percentual da variação: número com 1 casa, ou "—" sem base (mês anterior zero). */
function celulaPercentual(p: number | null): Valor {
  return p === null ? { texto: "—" } : { percentual: p };
}

/** Linhas do arquivo, independentes de formato. */
function linhasDoRelatorio(r: RelatorioContratos, geradoEm: string): Valor[][] {
  const t = (texto: string): Valor => ({ texto });
  const resumo: Valor[][] = [
    [t("Novos contratos no mês"), r.semContratos ? t("Nenhum contrato novo neste mês") : { inteiro: r.novos.quantidade }],
    [t("MRR novo (R$)"), { centavos: r.novos.mrrCentavos }],
    [t("Implantação a cobrar dos novos (R$)"), { centavos: r.novos.implantacaoACobrarCentavos }],
    [t(`Novos contratos em ${rotuloMes(r.mesAnterior)}`), { inteiro: r.anterior.quantidade }],
    [t(`Variação vs ${rotuloMes(r.mesAnterior)} (contratos)`), { inteiro: r.variacao.quantidade.absoluta }],
    [t(`Variação vs ${rotuloMes(r.mesAnterior)} (contratos, %)`), celulaPercentual(r.variacao.quantidade.percentual)],
    [t(`MRR novo em ${rotuloMes(r.mesAnterior)} (R$)`), { centavos: r.anterior.mrrCentavos }],
    [t(`Variação vs ${rotuloMes(r.mesAnterior)} (MRR, R$)`), { centavos: r.variacao.mrr.absoluta }],
    [t(`Variação vs ${rotuloMes(r.mesAnterior)} (MRR, %)`), celulaPercentual(r.variacao.mrr.percentual)],
    [t("Contratos encerrados no mês"), { inteiro: r.encerrados.quantidade }],
    [t(`Em aviso prévio em ${dataBr(r.dataReferencia)}`), { inteiro: r.emAvisoPrevio.quantidade }],
    [t("Saldo líquido (novos − encerrados)"), { inteiro: r.saldoLiquido.quantidade }],
    [t("Saldo líquido de MRR (R$)"), { centavos: r.saldoLiquido.mrrCentavos }]
  ];
  const tabela: Valor[][] = r.contratos.map((c) => [
    t(c.nome),
    t(c.uf),
    t(c.planoRotulo),
    { centavos: c.valorMensalCentavos },
    c.taxaImplantacaoCentavos === null ? t("—") : { centavos: c.taxaImplantacaoCentavos },
    t(dataBr(c.dataInicio)),
    t(rotuloStatusContrato(c.statusContrato)),
    t(ROTULO_ORIGEM[c.origem])
  ]);
  return [
    [t(TITULO_RELATORIO)],
    [t(`Mês: ${rotuloMes(r.mes)}`)],
    [t(`Gerado em: ${geradoEm} (horário de Brasília)`)],
    [t("Vigência a partir da assinatura: novo contrato = data de início (assinatura) dentro do mês.")],
    [],
    ...resumo,
    [],
    COLUNAS.map(t),
    ...tabela
  ];
}

export function gerarCsvContratos(r: RelatorioContratos, agora: Date): string {
  const linhas = linhasDoRelatorio(r, formatarGeradoEm(agora)).map((linha) =>
    linha.map((v) =>
      "texto" in v ? celulaTextoCsv(v.texto) : "centavos" in v ? centavosCsv(v.centavos) : "percentual" in v ? v.percentual.toFixed(1).replace(".", ",") : String(v.inteiro)
    )
  );
  return montarCsv(linhas);
}

export function gerarXlsxContratos(r: RelatorioContratos, agora: Date): Buffer {
  const linhas: CelulaXlsx[][] = linhasDoRelatorio(r, formatarGeradoEm(agora)).map((linha) =>
    linha.map((v): CelulaXlsx =>
      "texto" in v
        ? { tipo: "texto", valor: neutralizarFormula(v.texto) }
        : "centavos" in v
          ? { tipo: "numero", valor: centavosParaNumeric(v.centavos), estilo: "moeda" }
          : "percentual" in v
            ? { tipo: "numero", valor: v.percentual.toFixed(1), estilo: "decimal" }
            : { tipo: "numero", valor: String(v.inteiro), estilo: "inteiro" }
    )
  );
  return gerarXlsx(linhas, `Novos contratos ${r.mes}`);
}

/** Nome do arquivo baixado: "novos-contratos-2026-11.csv". */
export function nomeArquivoContratos(mes: string, extensao: "csv" | "xlsx"): string {
  return `novos-contratos-${mes}.${extensao}`;
}
