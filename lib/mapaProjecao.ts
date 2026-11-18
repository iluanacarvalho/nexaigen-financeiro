// Projeção do mapa do Brasil (rodada 15-B) — EQUIRETANGULAR simples:
// x proporcional à longitude, y à latitude (invertida), mesma escala nos
// dois eixos. Usada pelo script que gera os contornos dos estados
// (scripts/gerar-mapa-brasil.ts) E pela página /mapa pra posicionar os
// pontos — a mesma função nos dois lados, então ponto e contorno sempre
// batem. Funções puras.

export interface Limites {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

export const LARGURA_MAPA = 1000;

/**
 * Faixa de posição aceita pelo banco (CHECK ck_cliente_prefeitura_posicao_brasil
 * da 0013) — território brasileiro com as ilhas oceânicas. O mapa cobre a
 * faixa INTEIRA: todo ponto que o banco aceita cai dentro do desenho
 * (a malha "mínima" do IBGE não traz Fernando de Noronha, por exemplo).
 */
export const FAIXA_VALIDA: Limites = { lonMin: -74, lonMax: -28, latMin: -34, latMax: 6 };

export function dentroDaFaixa(lon: number, lat: number): boolean {
  return lon >= FAIXA_VALIDA.lonMin && lon <= FAIXA_VALIDA.lonMax && lat >= FAIXA_VALIDA.latMin && lat <= FAIXA_VALIDA.latMax;
}

export function alturaDoMapa(l: Limites): number {
  // Pra cima: o extremo sul (projetar arredonda a 0,1) nunca fica fora do viewBox.
  return Math.ceil((LARGURA_MAPA * (l.latMax - l.latMin)) / (l.lonMax - l.lonMin));
}

/** lon/lat → coordenadas do SVG (viewBox 0 0 LARGURA_MAPA alturaDoMapa), 1 casa decimal. */
export function projetar(lon: number, lat: number, l: Limites): { x: number; y: number } {
  const escala = LARGURA_MAPA / (l.lonMax - l.lonMin);
  return { x: Math.round((lon - l.lonMin) * escala * 10) / 10, y: Math.round((l.latMax - lat) * escala * 10) / 10 };
}
