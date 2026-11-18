// Base de municípios do Território (rodada 16-A2) — PARTE PURA da carga.
//
// scripts/gerar-base-municipios.ts <UF> baixa duas respostas da API pública
// do IBGE (servicodados.ibge.gov.br) e chama `montarBaseMunicipios`; o
// resultado vira scripts/dados/municipios-<UF>.json, COMMITADO (dado
// público, revisável num diff). scripts/importar-municipios.ts lê esse JSON
// (sem rede) e confere com `validarBaseMunicipios` antes de gravar.
//
// Nunca inventa dado: população ausente/sigilosa na API ("-", "...", "X")
// fica null e o município entra na lista `sem_populacao`; município sem
// microrregião (os criados depois da divisão do IBGE) fica com null.
// Testado em lib/baseMunicipios.test.ts com fixtures pequenas em
// testes/fixtures/.

import { codigoIbgeValido, nomeDeMunicipioNormalizado, ufDoCodigoIbge, UF_POR_CODIGO } from "./ibge";

export const URL_IBGE = "https://servicodados.ibge.gov.br/api";

/** Código numérico da UF no IBGE (41 = PR). */
export function codigoDaUf(uf: string): string | null {
  return Object.entries(UF_POR_CODIGO).find(([, sigla]) => sigla === uf)?.[0] ?? null;
}

/** Municípios da UF com micro e mesorregião (API de localidades v1). */
export function urlLocalidades(uf: string): string {
  return `${URL_IBGE}/v1/localidades/estados/${uf}/municipios`;
}

/** Estimativa de população MAIS RECENTE de todos os municípios da UF (agregado 6579, variável 9324, último período). */
export function urlPopulacao(uf: string): string {
  return `${URL_IBGE}/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6%5BN3%5B${codigoDaUf(uf)}%5D%5D`;
}

export interface MunicipioBase {
  codigo_ibge: string;
  nome: string;
  populacao: number | null;
  populacao_ano: number | null;
  microrregiao: string | null;
  mesorregiao: string | null;
}

export interface ArquivoBaseMunicipios {
  uf: string;
  fonte: { localidades: string; populacao: string; consultado_em: string };
  total: number;
  /** Códigos dos municípios sem população na API (null no arquivo — nunca inventada). */
  sem_populacao: string[];
  municipios: MunicipioBase[];
}

type Talvez<T> = T | null | undefined;
interface LocalidadeIbge {
  id?: unknown;
  nome?: unknown;
  microrregiao?: Talvez<{ nome?: unknown; mesorregiao?: Talvez<{ nome?: unknown; UF?: Talvez<{ sigla?: unknown }> }> }>;
  "regiao-imediata"?: Talvez<{ "regiao-intermediaria"?: Talvez<{ UF?: Talvez<{ sigla?: unknown }> }> }>;
}
interface AgregadoIbge {
  resultados?: { series?: { localidade?: { id?: unknown }; serie?: Record<string, unknown> }[] }[];
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** "7201" → 7201; "-", "...", "X", "" ou lixo → null. */
export function lerPopulacaoIbge(valor: unknown): number | null {
  if (typeof valor !== "string" || !/^[0-9]+$/.test(valor.trim())) return null;
  const n = Number(valor.trim());
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Monta o arquivo da UF a partir das duas respostas do IBGE. Lança se a
 * resposta de localidades vier estranha (código fora do padrão, de outra UF,
 * repetido, sem nome) — melhor não gerar arquivo do que gerar um errado.
 */
export function montarBaseMunicipios(uf: string, localidades: unknown, populacao: unknown, consultadoEm: string): ArquivoBaseMunicipios {
  if (!codigoDaUf(uf)) throw new Error(`UF inválida: ${uf}`);
  if (!Array.isArray(localidades) || localidades.length === 0) throw new Error("Resposta de localidades do IBGE vazia ou inesperada.");

  // População: a série de cada município; vale o ano MAIS RECENTE com número.
  const porCodigo = new Map<string, { populacao: number; ano: number }>();
  for (const resultado of (Array.isArray(populacao) ? (populacao as AgregadoIbge[]) : []).flatMap((v) => v.resultados ?? [])) {
    for (const s of resultado.series ?? []) {
      const codigo = String(s.localidade?.id ?? "");
      const anos = Object.entries(s.serie ?? {})
        .map(([ano, valor]) => ({ ano: Number(ano), populacao: lerPopulacaoIbge(valor) }))
        .filter((x): x is { ano: number; populacao: number } => Number.isInteger(x.ano) && x.populacao !== null)
        .sort((a, b) => b.ano - a.ano);
      if (anos[0]) porCodigo.set(codigo, anos[0]);
    }
  }

  const vistos = new Set<string>();
  const municipios = (localidades as LocalidadeIbge[]).map((m): MunicipioBase => {
    const codigo = String(m.id ?? "");
    const nome = texto(m.nome);
    if (!codigoIbgeValido(codigo)) throw new Error(`Código IBGE fora do padrão (7 dígitos): "${codigo}".`);
    if (ufDoCodigoIbge(codigo) !== uf) throw new Error(`Município ${codigo} não é de ${uf}.`);
    const siglaInformada = m.microrregiao?.mesorregiao?.UF?.sigla ?? m["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla;
    if (siglaInformada !== undefined && siglaInformada !== uf) throw new Error(`Município ${codigo} veio com UF ${String(siglaInformada)}.`);
    if (!nome) throw new Error(`Município ${codigo} sem nome.`);
    if (vistos.has(codigo)) throw new Error(`Município ${codigo} repetido.`);
    vistos.add(codigo);
    const pop = porCodigo.get(codigo);
    return {
      codigo_ibge: codigo,
      nome,
      populacao: pop?.populacao ?? null,
      populacao_ano: pop?.ano ?? null,
      microrregiao: texto(m.microrregiao?.nome),
      mesorregiao: texto(m.microrregiao?.mesorregiao?.nome)
    };
  });
  municipios.sort((a, b) => a.codigo_ibge.localeCompare(b.codigo_ibge));

  return {
    uf,
    fonte: { localidades: urlLocalidades(uf), populacao: urlPopulacao(uf), consultado_em: consultadoEm },
    total: municipios.length,
    sem_populacao: municipios.filter((m) => m.populacao === null).map((m) => m.codigo_ibge),
    municipios
  };
}

/** Linha pronta pro banco (com o nome normalizado de busca). */
export interface MunicipioParaGravar extends MunicipioBase {
  uf: string;
  nome_busca: string;
}

/**
 * Confere o arquivo COMMITADO antes de gravar (alguém pode ter editado à
 * mão): UF certa, total batendo, códigos de 7 dígitos da UF, sem repetição,
 * nome presente, população inteira ≥ 0 (ou null) com ano. Devolve TODOS os
 * erros de uma vez.
 */
export function validarBaseMunicipios(arquivo: unknown, uf: string): { ok: true; municipios: MunicipioParaGravar[] } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  const a = arquivo as Partial<ArquivoBaseMunicipios> | null;
  if (!a || typeof a !== "object" || !Array.isArray(a.municipios)) return { ok: false, erros: ["Arquivo sem a lista `municipios`."] };
  if (a.uf !== uf) erros.push(`O arquivo é de ${String(a.uf)}, não de ${uf}.`);
  if (a.total !== a.municipios.length) erros.push(`total = ${String(a.total)}, mas a lista tem ${a.municipios.length} municípios.`);
  const vistos = new Set<string>();
  const municipios: MunicipioParaGravar[] = [];
  a.municipios.forEach((m, i) => {
    const onde = `municipios[${i}]`;
    const codigo = String(m?.codigo_ibge ?? "");
    if (!codigoIbgeValido(codigo)) erros.push(`${onde}: código IBGE "${codigo}" não tem 7 dígitos.`);
    else if (ufDoCodigoIbge(codigo) !== uf) erros.push(`${onde}: o código ${codigo} não é de ${uf}.`);
    if (vistos.has(codigo)) erros.push(`${onde}: código ${codigo} repetido.`);
    vistos.add(codigo);
    const nome = texto(m?.nome);
    if (!nome) erros.push(`${onde}: sem nome.`);
    const pop = m?.populacao ?? null;
    if (pop !== null && (!Number.isSafeInteger(pop) || pop < 0)) erros.push(`${onde}: população inválida (${String(pop)}).`);
    if (pop !== null && !Number.isInteger(m?.populacao_ano)) erros.push(`${onde}: população sem ano.`);
    if (nome && codigoIbgeValido(codigo)) {
      municipios.push({
        codigo_ibge: codigo,
        nome,
        nome_busca: nomeDeMunicipioNormalizado(nome),
        uf,
        populacao: pop,
        populacao_ano: pop === null ? (m?.populacao_ano ?? null) : m!.populacao_ano,
        microrregiao: texto(m?.microrregiao),
        mesorregiao: texto(m?.mesorregiao)
      });
    }
  });
  return erros.length ? { ok: false, erros } : { ok: true, municipios };
}
