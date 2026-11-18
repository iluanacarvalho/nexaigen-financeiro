// Exportação da carteira de leads (rodada 16-A) — CSV e XLSX, SÓ admin
// (GET /api/leads/exportar, área crm_gestao). Mesmas regras de planilha do
// resto do sistema: lib/exportacao.ts (BOM, ";", neutralização de fórmula,
// centavos com vírgula) e lib/xlsx.ts (texto inline, dinheiro numérico a
// partir de centavos inteiros). Cabeçalho com título, filtros e data de
// geração. Funções puras.

import { centavosParaNumeric } from "./dinheiro";
import { celulaTextoCsv, centavosCsv, formatarGeradoEm, montarCsv, neutralizarFormula } from "./exportacao";
import { ROTULO_ETAPA, ROTULO_MOTIVO_PERDA, ROTULO_ORIGEM, diaEmSaoPaulo, type MotivoPerda, type Origem } from "./crm";
import type { LeadListado } from "./crmRepositorio";
import { rotuloDoPlano } from "./planos";
import { gerarXlsx, type CelulaXlsx } from "./xlsx";

export const TITULO_EXPORTACAO_CRM = "NEXAIGEN — Carteira de leads (CRM)";

const COLUNAS = [
  "Município", "UF", "Código IBGE", "Etapa", "Vendedor", "Plano de interesse", "Valor mensal estimado (R$)", "Origem",
  "Contato", "Cargo", "E-mail", "Telefone", "Próxima ação", "Descrição da próxima ação", "Última atividade", "Motivo da perda", "Criado em"
];

type Valor = { texto: string } | { centavos: number } | null;

/** Dia "aaaa-mm-dd" → "dd/mm/aaaa". */
const dataBr = (dia: string | null) => (dia ? dia.split("-").reverse().join("/") : "");
/** Instante (timestamptz ISO) → dia em America/Sao_Paulo, "dd/mm/aaaa". */
const instanteBr = (instante: string) => dataBr(diaEmSaoPaulo(instante));

function linhas(leads: LeadListado[], filtros: string, geradoEm: string): Valor[][] {
  const t = (texto: string | null): Valor => ({ texto: texto ?? "" });
  return [
    [t(TITULO_EXPORTACAO_CRM)],
    [t(`Filtros: ${filtros || "nenhum"}`)],
    [t(`Gerado em: ${geradoEm} (horário de Brasília)`)],
    [t(`Leads: ${leads.length}`)],
    [],
    COLUNAS.map(t),
    ...leads.map((l): Valor[] => [
      t(l.municipio_nome),
      t(l.uf),
      t(l.codigo_ibge),
      t(ROTULO_ETAPA[l.etapa]),
      t(l.vendedor_nome),
      t(l.plano_interesse ? rotuloDoPlano(l.plano_interesse) : ""),
      l.valor_mensal_estimado_centavos === null ? t("") : { centavos: l.valor_mensal_estimado_centavos },
      t(ROTULO_ORIGEM[l.origem as Origem] ?? l.origem),
      t(l.contato_nome),
      t(l.contato_cargo),
      t(l.contato_email),
      t(l.contato_telefone),
      t(dataBr(l.proxima_acao_em)),
      t(l.proxima_acao_descricao),
      t(instanteBr(l.ultima_atividade_em)),
      t(l.motivo_perda ? ROTULO_MOTIVO_PERDA[l.motivo_perda as MotivoPerda] : ""),
      t(instanteBr(l.criado_em))
    ])
  ];
}

export function gerarCsvCarteira(leads: LeadListado[], filtros: string, agora: Date): string {
  return montarCsv(linhas(leads, filtros, formatarGeradoEm(agora)).map((l) => l.map((v) => (v === null ? "" : "texto" in v ? celulaTextoCsv(v.texto) : centavosCsv(v.centavos)))));
}

export function gerarXlsxCarteira(leads: LeadListado[], filtros: string, agora: Date): Buffer {
  return gerarXlsx(
    linhas(leads, filtros, formatarGeradoEm(agora)).map((l) =>
      l.map((v): CelulaXlsx => (v === null ? null : "texto" in v ? { tipo: "texto", valor: neutralizarFormula(v.texto) } : { tipo: "numero", valor: centavosParaNumeric(v.centavos), estilo: "moeda" }))
    ),
    "Carteira de leads"
  );
}
