// Consulta do Território (rodada 16-A2) — o caminho ÚNICO de "filtros da
// URL → linhas filtradas, ordenadas, resumo e página". Usado pela tela
// (/crm/territorio e /crm/entidades/[id]), pela API (GET /api/territorio),
// pela exportação e pelo lote "todos os resultados ainda não abordados":
// os números da planilha e do lote são os MESMOS da tela.

import type { Executor } from "./db";
import {
  POR_PAGINA_TERRITORIO,
  filtrarLinhas,
  lerFiltrosTerritorio,
  ordenarLinhas,
  resumirLinhas,
  sanearFiltros,
  type FiltrosTerritorio,
  type Leitor,
  type LinhaTerritorio,
  type ResumoTerritorio
} from "./territorio";
import { carregarLinhas, entidadesAtivasVisiveis, ufsLiberadas, ufsVisiveis } from "./territorioRepositorio";

export interface ResultadoTerritorio {
  filtros: FiltrosTerritorio;
  /** Filtros ignorados (valor inválido, entidade removida, estado não liberado…) — a tela mostra, nunca quebra. */
  avisos: string[];
  /** UF efetivamente mostrada (null = nenhuma — estado vazio). */
  uf: string | null;
  ufsVisiveis: string[];
  ufsLiberadas: string[];
  /** TODAS as linhas filtradas e ordenadas (a exportação e o lote usam todas). */
  todas: LinhaTerritorio[];
  /** Só a página pedida. */
  pagina: LinhaTerritorio[];
  total: number;
  resumo: ResumoTerritorio;
  /** Municípios carregados ANTES dos filtros (0 = base da UF não importada — estado vazio da tela). */
  carregadas: number;
}

/**
 * `entidadeId` (tela da entidade): os membros da entidade, de qualquer UF
 * visível — a UF do filtro, se vier, só restringe. Sem entidade: a UF do
 * filtro, ou a primeira liberada (admin sem nenhuma liberada: nenhuma).
 */
export async function consultarTerritorio(
  entrada: URLSearchParams | Record<string, string | string[] | undefined>,
  leitor: Leitor,
  hoje: string,
  /** `linhas`: as linhas da entidade JÁ carregadas (obterEntidade) — evita ler duas vezes. */
  opcoes: { entidadeId?: string; linhas?: LinhaTerritorio[] } = {},
  executor?: Executor
): Promise<ResultadoTerritorio> {
  const lidos = lerFiltrosTerritorio(entrada);
  const [visiveis, liberadas, existentes] = await Promise.all([
    ufsVisiveis(leitor, executor),
    ufsLiberadas(executor),
    entidadesAtivasVisiveis(lidos.filtros.entidade ? [lidos.filtros.entidade] : [], leitor, executor)
  ]);
  const saneados = sanearFiltros(lidos.filtros, { admin: leitor.admin, ufsVisiveis: visiveis, entidadeExiste: (id) => existentes.has(id) });
  const filtros = saneados.filtros;
  const avisos = [...lidos.avisos, ...saneados.avisos];

  let uf: string | null;
  let linhas: LinhaTerritorio[];
  if (opcoes.entidadeId) {
    uf = filtros.uf ?? null;
    linhas = opcoes.linhas ?? (await carregarLinhas({ entidadeId: opcoes.entidadeId, uf: filtros.uf }, leitor, hoje, executor));
  } else {
    uf = filtros.uf ?? liberadas.find((u) => visiveis.includes(u)) ?? null;
    filtros.uf = uf ?? undefined;
    linhas = uf ? await carregarLinhas({ uf, entidadeId: filtros.entidade }, leitor, hoje, executor) : [];
  }
  const todas = ordenarLinhas(filtrarLinhas(linhas, filtros), filtros.ordenar, filtros.direcao);
  const ultimaPagina = Math.max(1, Math.ceil(todas.length / POR_PAGINA_TERRITORIO));
  if (filtros.pagina > ultimaPagina) filtros.pagina = ultimaPagina;
  const inicio = (filtros.pagina - 1) * POR_PAGINA_TERRITORIO;
  return { filtros, avisos, uf, ufsVisiveis: visiveis, ufsLiberadas: liberadas, todas, pagina: todas.slice(inicio, inicio + POR_PAGINA_TERRITORIO), total: todas.length, resumo: resumirLinhas(todas), carregadas: linhas.length };
}
