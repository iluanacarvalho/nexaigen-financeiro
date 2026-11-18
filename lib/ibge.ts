// Código IBGE do município → nome/UF oficiais e posição (rodada 15-B).
//
// QUANDO É USADO: só quando a equipe grava o código IBGE de um cliente no
// painel interno (PUT /api/clientes/[id]/divulgacao). O resultado
// (latitude/longitude) é GRAVADO no cliente; o endpoint público do mapa
// lê do banco e NUNCA chama o IBGE — o mapa não depende de terceiros em
// tempo de uso.
//
// FONTE: API pública de localidades e malhas do IBGE
// (servicodados.ibge.gov.br, dados abertos):
//   - /api/v1/localidades/municipios/{id} → nome e UF. Código inexistente
//     devolve `[]`. Município criado depois da divisão em microrregiões
//     (ex.: 5101837) vem com `microrregiao: null` — a UF sai então da
//     região imediata;
//   - /api/v3/malhas/municipios/{id}?formato=application/vnd.geo+json →
//     contorno do município; a posição gravada é o CENTROIDE da área.
//
// NUNCA LANÇA por falha de rede: tempo-limite curto, e qualquer erro
// (rede, HTTP, JSON inesperado) vira { status: "indisponivel" } — quem
// chama salva o código sem posição ("posição pendente"). A função de
// fetch é parâmetro (testes passam um fetch falso; o setup
// vitest.setup.sem-apis-externas.ts bloqueia rede real de qualquer jeito).

import { dentroDaFaixa } from "./mapaProjecao";

const BASE = "https://servicodados.ibge.gov.br/api";
export const TEMPO_LIMITE_IBGE_MS = 5000;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// --- Código ---------------------------------------------------------------------

/** Código IBGE de município: exatamente 7 dígitos (o mesmo CHECK da 0013). */
export function codigoIbgeValido(codigo: string): boolean {
  return /^[0-9]{7}$/.test(codigo);
}

/**
 * O 1º e 2º dígitos do código são o código da UF (IBGE). Serve pra conferir
 * a UF sem rede nenhuma — o painel avisa divergência mesmo com o IBGE fora.
 */
export const UF_POR_CODIGO: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF"
};

export function ufDoCodigoIbge(codigo: string): string | null {
  return UF_POR_CODIGO[codigo.slice(0, 2)] ?? null;
}

// --- Centroide --------------------------------------------------------------------

type Anel = [number, number][];
type GeoJson =
  | { type: "Polygon"; coordinates: Anel[] }
  | { type: "MultiPolygon"; coordinates: Anel[][] }
  | { type: "Feature"; geometry: GeoJson }
  | { type: "FeatureCollection"; features: { geometry: GeoJson }[] };

/** Área com sinal e momentos de um anel (fórmula do laço / shoelace), no plano lon×lat. */
function momentosDoAnel(anel: Anel): { area: number; cx: number; cy: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < anel.length - 1; i++) {
    const [x0, y0] = anel[i];
    const [x1, y1] = anel[i + 1];
    const cruz = x0 * y1 - x1 * y0;
    area += cruz;
    cx += (x0 + x1) * cruz;
    cy += (y0 + y1) * cruz;
  }
  return { area: area / 2, cx, cy };
}

function poligonos(g: GeoJson): Anel[][] {
  switch (g.type) {
    case "Polygon":
      return [g.coordinates];
    case "MultiPolygon":
      return g.coordinates;
    case "Feature":
      return poligonos(g.geometry);
    case "FeatureCollection":
      return g.features.flatMap((f) => poligonos(f.geometry));
  }
}

/**
 * Centroide de ÁREA (não a média dos vértices) de um Polygon/MultiPolygon/
 * Feature/FeatureCollection GeoJSON. Plano lon×lat — pra um município a
 * distorção é desprezível (o mapa mostra posição APROXIMADA). Cada anel
 * externo soma área, cada buraco subtrai — independente da orientação em
 * que o arquivo veio (o sinal é normalizado por polígono). Anel aberto (o
 * último ponto ≠ o primeiro) é fechado. Sem área → null.
 */
export function centroide(geo: unknown): { lat: number; lon: number } | null {
  let area = 0;
  let mx = 0;
  let my = 0;
  try {
    for (const poligono of poligonos(geo as GeoJson)) {
      poligono.forEach((anelOriginal, indice) => {
        const anel = anelOriginal.length > 0 && (anelOriginal[0][0] !== anelOriginal.at(-1)![0] || anelOriginal[0][1] !== anelOriginal.at(-1)![1]) ? [...anelOriginal, anelOriginal[0]] : anelOriginal;
        const m = momentosDoAnel(anel);
        // Externo (índice 0) sempre positivo; buracos sempre negativos.
        const sinal = (indice === 0 ? 1 : -1) * Math.sign(m.area);
        area += sinal * m.area;
        mx += sinal * m.cx;
        my += sinal * m.cy;
      });
    }
  } catch {
    return null;
  }
  if (!Number.isFinite(area) || area <= 0) return null;
  return { lon: mx / (6 * area), lat: my / (6 * area) };
}

/** Arredonda a 6 casas (numeric(9,6) do banco) e confere a faixa do território (lib/mapaProjecao.ts#FAIXA_VALIDA = CHECK da 0013). */
export function posicaoNoBrasil(p: { lat: number; lon: number }): { lat: number; lon: number } | null {
  const lat = Math.round(p.lat * 1e6) / 1e6;
  const lon = Math.round(p.lon * 1e6) / 1e6;
  return dentroDaFaixa(lon, lat) ? { lat, lon } : null;
}

// --- Conferência de nome/UF ---------------------------------------------------------

/** Minúsculas, sem acento, sem pontuação, espaços simples. */
export function normalizarNome(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PREFIXOS = ["prefeitura municipal de", "prefeitura municipal da", "prefeitura municipal do", "prefeitura de", "prefeitura da", "prefeitura do", "municipio de", "municipio da", "municipio do", "prefeitura"];

/**
 * Nome de município comparável: sem acento, sem caixa, sem pontuação e sem
 * o prefixo "Prefeitura Municipal de"/"Município de"/"Prefeitura de".
 * "Prefeitura Municipal de Jaguapitã" e "jaguapita" viram o mesmo texto.
 * Usado pra conferir o código IBGE (abaixo) e, desde a rodada 16-A, como
 * chave de duplicidade e de busca do CRM (lead.nome_busca).
 */
export function nomeDeMunicipioNormalizado(nome: string): string {
  const normalizado = normalizarNome(nome);
  for (const prefixo of PREFIXOS) {
    if (normalizado.startsWith(`${prefixo} `)) return normalizado.slice(prefixo.length + 1);
  }
  return normalizado;
}

/**
 * O código IBGE confere com o cliente? UF igual E o nome do cliente, sem o
 * prefixo "Prefeitura Municipal de"/"Município de", igual ao nome oficial
 * (acentos e caixa ignorados). Divergência não bloqueia nada — a tela só avisa.
 */
export function municipioConfere(cliente: { nome: string; uf: string }, ibge: { nome: string; uf: string }): boolean {
  if (cliente.uf.trim().toUpperCase() !== ibge.uf.toUpperCase()) return false;
  return nomeDeMunicipioNormalizado(cliente.nome) === normalizarNome(ibge.nome);
}

// --- Consulta ---------------------------------------------------------------------

export type ResultadoIbge =
  | { status: "ok"; nome: string; uf: string; posicao: { lat: number; lon: number } | null }
  | { status: "nao_encontrado" }
  | { status: "indisponivel" };

async function lerJson(fetchImpl: Fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TEMPO_LIMITE_IBGE_MS), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
  return res.json();
}

interface MunicipioIbge {
  nome?: unknown;
  microrregiao?: { mesorregiao?: { UF?: { sigla?: unknown } } } | null;
  "regiao-imediata"?: { "regiao-intermediaria"?: { UF?: { sigla?: unknown } } } | null;
}

/**
 * Nome, UF e posição (centroide) do município. Nome/UF indisponíveis →
 * "indisponivel"; malha indisponível (nome/UF ok) → status "ok" com
 * posicao null (posição pendente). Código que o IBGE não conhece → "nao_encontrado".
 */
export async function buscarMunicipioIbge(codigo: string, fetchImpl: Fetch = fetch): Promise<ResultadoIbge> {
  if (!codigoIbgeValido(codigo)) return { status: "nao_encontrado" };

  let municipio: MunicipioIbge;
  try {
    const dados = await lerJson(fetchImpl, `${BASE}/v1/localidades/municipios/${codigo}`);
    if (Array.isArray(dados) || dados === null || typeof dados !== "object") return { status: "nao_encontrado" };
    municipio = dados as MunicipioIbge;
  } catch {
    return { status: "indisponivel" };
  }
  const uf = municipio.microrregiao?.mesorregiao?.UF?.sigla ?? municipio["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla;
  if (typeof municipio.nome !== "string" || typeof uf !== "string") return { status: "indisponivel" };

  let posicao: { lat: number; lon: number } | null = null;
  try {
    const malha = await lerJson(fetchImpl, `${BASE}/v3/malhas/municipios/${codigo}?formato=application/vnd.geo%2Bjson`);
    const c = centroide(malha);
    posicao = c ? posicaoNoBrasil(c) : null;
  } catch {
    posicao = null;
  }
  return { status: "ok", nome: municipio.nome, uf, posicao };
}
