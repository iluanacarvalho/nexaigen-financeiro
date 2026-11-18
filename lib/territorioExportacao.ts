// Exportação da lista FILTRADA do Território / da tela da entidade (rodada
// 16-A2) — CSV e XLSX, SÓ admin (área crm_gestao). Mesmos exportadores do
// resto do sistema (lib/exportacao.ts: BOM, ";", fórmulas neutralizadas;
// lib/xlsx.ts: texto inline). Cabeçalho com título, filtros aplicados e data
// de geração. As linhas vêm de lib/territorioConsulta.ts — as MESMAS da tela.
//
// COLUNAS fixas (o teste confere a lista exata): nenhum contato, valor ou
// nota — só dado institucional do município e o status comercial.

import { celulaTextoCsv, formatarGeradoEm, montarCsv, neutralizarFormula } from "./exportacao";
import { ROTULO_ETAPA } from "./crm";
import { ROTULO_ORIGEM_PLANO, rotuloPlanoEfetivo, rotuloStatusDaLinha, type LinhaTerritorio } from "./territorio";
import { gerarXlsx, type CelulaXlsx } from "./xlsx";

export const TITULO_EXPORTACAO_TERRITORIO = "NEXAIGEN — Território comercial";

export const COLUNAS_EXPORTACAO_TERRITORIO = ["Município", "UF", "Código IBGE", "População", "Plano efetivo", "Origem do plano", "Status", "Etapa", "Vendedor", "Entidades"] as const;

type Valor = { texto: string } | { inteiro: number } | null;

function linhas(dados: LinhaTerritorio[], titulo: string, filtros: string, geradoEm: string): Valor[][] {
  const t = (texto: string | null): Valor => ({ texto: texto ?? "" });
  return [
    [t(titulo)],
    [t(`Filtros: ${filtros || "nenhum"}`)],
    [t(`Gerado em: ${geradoEm} (horário de Brasília)`)],
    [t(`Prefeituras: ${dados.length}`)],
    [],
    COLUNAS_EXPORTACAO_TERRITORIO.map(t),
    ...dados.map((l): Valor[] => [
      t(l.nome),
      t(l.uf),
      t(l.codigo_ibge),
      l.populacao === null ? t("") : { inteiro: l.populacao },
      t(rotuloPlanoEfetivo(l.plano)),
      t(ROTULO_ORIGEM_PLANO[l.plano.origem]),
      t(rotuloStatusDaLinha(l)),
      t(l.lead ? ROTULO_ETAPA[l.lead.etapa] : ""),
      t(l.lead?.vendedor_nome ?? ""),
      t(l.entidades.map((e) => (e.sigla ? `${e.nome} (${e.sigla})` : e.nome)).join(" | "))
    ])
  ];
}

export function gerarCsvTerritorio(dados: LinhaTerritorio[], filtros: string, agora: Date, titulo = TITULO_EXPORTACAO_TERRITORIO): string {
  return montarCsv(linhas(dados, titulo, filtros, formatarGeradoEm(agora)).map((l) => l.map((v) => (v === null ? "" : "texto" in v ? celulaTextoCsv(v.texto) : String(v.inteiro)))));
}

export function gerarXlsxTerritorio(dados: LinhaTerritorio[], filtros: string, agora: Date, titulo = TITULO_EXPORTACAO_TERRITORIO): Buffer {
  return gerarXlsx(
    linhas(dados, titulo, filtros, formatarGeradoEm(agora)).map((l) =>
      l.map((v): CelulaXlsx => (v === null ? null : "texto" in v ? { tipo: "texto", valor: neutralizarFormula(v.texto) } : { tipo: "numero", valor: String(v.inteiro), estilo: "inteiro" }))
    ),
    "Território"
  );
}
