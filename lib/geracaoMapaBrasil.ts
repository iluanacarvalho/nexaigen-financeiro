// Parte PURA da geração do mapa do Brasil (rodada 15-C — extraída de
// scripts/gerar-mapa-brasil.ts): recebe o GeoJSON da malha por UF como
// PARÂMETRO e devolve o conteúdo de lib/mapaBrasil.gerado.ts. Nenhuma
// rede, nenhum arquivo, nenhum relógio — mesma entrada, mesmo texto
// (testado em lib/geracaoMapaBrasil.test.ts com uma fixture de 3 estados).
// O script passa a ser só "baixar → chamar esta função → gravar".
//
//   - leitura: FeatureCollection com `properties.codarea` (código IBGE da
//     UF, 2 dígitos) e geometria Polygon/MultiPolygon — qualquer outra
//     coisa (UF desconhecida, UF repetida, geometria estranha, coordenada
//     não numérica) é REJEITADA com mensagem clara, nunca desenhada torta;
//   - limites: a malha + margem, estendidos pra cobrir toda a faixa que o
//     banco aceita (lib/mapaProjecao.ts#FAIXA_VALIDA) — qualquer posição
//     gravável cai dentro do desenho (a malha "mínima" não traz Fernando de
//     Noronha);
//   - simplificação: projeção arredondada a 0,1 unidade
//     (lib/mapaProjecao.ts#projetar) e pontos consecutivos repetidos depois
//     do arredondamento saem (não mudam o desenho, só o tamanho);
//   - ordem estável: estados por sigla da UF, anéis na ordem do arquivo.

import { UF_POR_CODIGO } from "./ibge";
import { FAIXA_VALIDA, LARGURA_MAPA, alturaDoMapa, projetar, type Limites } from "./mapaProjecao";

export const MARGEM_GRAUS = 0.5;
export const TOTAL_UFS = 27;

type Anel = [number, number][];

export interface MapaBrasil {
  largura: number;
  altura: number;
  limites: Limites;
  estados: { uf: string; d: string }[];
}

function erro(mensagem: string): never {
  throw new Error(`Malha inválida: ${mensagem}`);
}

function lerAnel(anel: unknown, onde: string): Anel {
  if (!Array.isArray(anel) || anel.length < 4) erro(`${onde}: anel com menos de 4 pontos.`);
  return anel.map((p) => {
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number" || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      erro(`${onde}: coordenada não numérica.`);
    }
    return [p[0], p[1]] as [number, number];
  });
}

/** Lê e valida a malha → polígonos por UF (código IBGE → sigla). */
export function lerMalhaPorUf(malha: unknown, exigirTodasAsUfs: boolean): { uf: string; poligonos: Anel[][] }[] {
  const m = malha as { type?: unknown; features?: unknown };
  if (!m || m.type !== "FeatureCollection" || !Array.isArray(m.features)) erro("esperava um FeatureCollection GeoJSON.");
  const vistas = new Set<string>();
  const estados = m.features.map((f: unknown) => {
    const feicao = f as { properties?: { codarea?: unknown }; geometry?: { type?: unknown; coordinates?: unknown } };
    const codarea = feicao?.properties?.codarea;
    const uf = typeof codarea === "string" ? UF_POR_CODIGO[codarea] : undefined;
    if (!uf) erro(`código de UF desconhecido: ${JSON.stringify(codarea)}.`);
    if (vistas.has(uf)) erro(`UF repetida: ${uf}.`);
    vistas.add(uf);
    const g = feicao.geometry;
    const coords = g?.coordinates;
    if (!Array.isArray(coords)) erro(`${uf}: geometria sem coordenadas.`);
    let poligonos: unknown[];
    if (g?.type === "Polygon") poligonos = [coords];
    else if (g?.type === "MultiPolygon") poligonos = coords;
    else erro(`${uf}: geometria ${JSON.stringify(g?.type)} (esperava Polygon ou MultiPolygon).`);
    return {
      uf,
      poligonos: poligonos.map((p, i) => {
        if (!Array.isArray(p) || p.length === 0) erro(`${uf}: polígono ${i} vazio.`);
        return p.map((anel, j) => lerAnel(anel, `${uf}, polígono ${i}, anel ${j}`));
      })
    };
  });
  if (estados.length === 0) erro("nenhuma UF.");
  if (exigirTodasAsUfs && estados.length !== TOTAL_UFS) erro(`esperava ${TOTAL_UFS} UFs, veio ${estados.length}.`);
  return estados;
}

/** Limites do desenho: malha + margem, estendidos pela faixa válida do banco; 1 casa decimal, sempre "pra fora". */
export function calcularLimites(pontos: [number, number][]): Limites {
  const lons = pontos.map((p) => p[0]);
  const lats = pontos.map((p) => p[1]);
  return {
    lonMin: Math.floor((Math.min(FAIXA_VALIDA.lonMin, ...lons) - MARGEM_GRAUS) * 10) / 10,
    lonMax: Math.ceil((Math.max(FAIXA_VALIDA.lonMax, ...lons) + MARGEM_GRAUS) * 10) / 10,
    latMin: Math.floor((Math.min(FAIXA_VALIDA.latMin, ...lats) - MARGEM_GRAUS) * 10) / 10,
    latMax: Math.ceil((Math.max(FAIXA_VALIDA.latMax, ...lats) + MARGEM_GRAUS) * 10) / 10
  };
}

/** Anel → comando de path SVG ("M x y L x y … Z"), sem pontos consecutivos repetidos depois do arredondamento. */
export function anelParaPath(anel: Anel, limites: Limites): string {
  const pontos = anel.map(([lon, lat]) => projetar(lon, lat, limites));
  const unicos = pontos.filter((p, i) => i === 0 || p.x !== pontos[i - 1].x || p.y !== pontos[i - 1].y);
  return `M${unicos.map((p) => `${p.x} ${p.y}`).join("L")}Z`;
}

export function montarMapaBrasil(malha: unknown, opcoes: { exigirTodasAsUfs: boolean }): MapaBrasil {
  const porUf = lerMalhaPorUf(malha, opcoes.exigirTodasAsUfs);
  const limites = calcularLimites(porUf.flatMap((e) => e.poligonos.flat(2)));
  const estados = porUf
    .map((e) => ({ uf: e.uf, d: e.poligonos.flatMap((p) => p.map((anel) => anelParaPath(anel, limites))).join("") }))
    .sort((a, b) => a.uf.localeCompare(b.uf));
  return { largura: LARGURA_MAPA, altura: alturaDoMapa(limites), limites, estados };
}

/** Conteúdo COMPLETO de lib/mapaBrasil.gerado.ts. Exige as 27 UFs por padrão. */
export function gerarArquivoMapaBrasil(malha: unknown, fonteUrl: string, opcoes: { exigirTodasAsUfs: boolean } = { exigirTodasAsUfs: true }): string {
  const { largura, altura, limites, estados } = montarMapaBrasil(malha, opcoes);
  return `// GERADO por scripts/gerar-mapa-brasil.ts — não editar à mão (rode o script de novo).
// Contornos dos 27 estados a partir da malha pública do IBGE (qualidade
// mínima), projeção equiretangular (lib/mapaProjecao.ts). Arquivo estático:
// a página /mapa não baixa nada de terceiros.
// Fonte: ${fonteUrl}

import type { Limites } from "./mapaProjecao";

export const MAPA_BRASIL: { fonte: string; largura: number; altura: number; limites: Limites; estados: { uf: string; d: string }[] } = ${JSON.stringify(
    { fonte: "IBGE — malha do Brasil por UF (dados públicos)", largura, altura, limites, estados },
    null,
    2
  )};
`;
}
