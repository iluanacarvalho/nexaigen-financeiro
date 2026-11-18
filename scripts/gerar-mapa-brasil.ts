// Gera lib/mapaBrasil.gerado.ts — contornos dos 27 estados em SVG, pra
// página pública /mapa (rodada 15-B). Roda UMA vez (o resultado é um
// arquivo estático versionado junto com o código); a página nunca baixa
// nada de terceiros.
//
//   npm run gerar-mapa-brasil
//
// Fonte: malha do Brasil por UF da API do IBGE (dados públicos), qualidade
// "mínima" — https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR
// ?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF
// Projeção: lib/mapaProjecao.ts (equiretangular), com os limites
// calculados da própria malha + uma margem. Só roda à mão: nenhum teste nem
// build chama isto.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { UF_POR_CODIGO } from "../lib/ibge";
import { FAIXA_VALIDA, LARGURA_MAPA, alturaDoMapa, projetar, type Limites } from "../lib/mapaProjecao";

const URL_MALHA = "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=UF";
const MARGEM_GRAUS = 0.5;

type Anel = [number, number][];
interface Feicao {
  properties: { codarea: string };
  geometry: { type: "Polygon"; coordinates: Anel[] } | { type: "MultiPolygon"; coordinates: Anel[][] };
}

async function main() {
  const res = await fetch(URL_MALHA, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
  const malha = (await res.json()) as { features: Feicao[] };

  const poligonos = (f: Feicao): Anel[][] => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);
  const todos = malha.features.flatMap((f) => poligonos(f).flat(2));
  // Limites = malha + margem, ESTENDIDOS pra cobrir toda a faixa que o banco aceita (FAIXA_VALIDA):
  // qualquer posição gravável cai dentro do desenho (a malha mínima não traz Fernando de Noronha).
  const limites: Limites = {
    lonMin: Math.floor((Math.min(FAIXA_VALIDA.lonMin, ...todos.map((p) => p[0])) - MARGEM_GRAUS) * 10) / 10,
    lonMax: Math.ceil((Math.max(FAIXA_VALIDA.lonMax, ...todos.map((p) => p[0])) + MARGEM_GRAUS) * 10) / 10,
    latMin: Math.floor((Math.min(FAIXA_VALIDA.latMin, ...todos.map((p) => p[1])) - MARGEM_GRAUS) * 10) / 10,
    latMax: Math.ceil((Math.max(FAIXA_VALIDA.latMax, ...todos.map((p) => p[1])) + MARGEM_GRAUS) * 10) / 10
  };

  const estados = malha.features
    .map((f) => {
      const uf = UF_POR_CODIGO[f.properties.codarea];
      if (!uf) throw new Error(`codarea desconhecido: ${f.properties.codarea}`);
      const d = poligonos(f)
        .flatMap((poligono) =>
          poligono.map((anel) => {
            const pontos = anel.map(([lon, lat]) => projetar(lon, lat, limites));
            // Pontos repetidos depois do arredondamento não mudam o desenho — saem (arquivo menor).
            const unicos = pontos.filter((p, i) => i === 0 || p.x !== pontos[i - 1].x || p.y !== pontos[i - 1].y);
            return `M${unicos.map((p) => `${p.x} ${p.y}`).join("L")}Z`;
          })
        )
        .join("");
      return { uf, d };
    })
    .sort((a, b) => a.uf.localeCompare(b.uf));
  if (estados.length !== 27) throw new Error(`Esperava 27 UFs, veio ${estados.length}.`);

  const conteudo = `// GERADO por scripts/gerar-mapa-brasil.ts — não editar à mão (rode o script de novo).
// Contornos dos 27 estados a partir da malha pública do IBGE (qualidade
// mínima), projeção equiretangular (lib/mapaProjecao.ts). Arquivo estático:
// a página /mapa não baixa nada de terceiros.
// Fonte: ${URL_MALHA}

import type { Limites } from "./mapaProjecao";

export const MAPA_BRASIL: { fonte: string; largura: number; altura: number; limites: Limites; estados: { uf: string; d: string }[] } = ${JSON.stringify(
    { fonte: "IBGE — malha do Brasil por UF (dados públicos)", largura: LARGURA_MAPA, altura: alturaDoMapa(limites), limites, estados },
    null,
    2
  )};
`;
  const destino = join(__dirname, "..", "lib", "mapaBrasil.gerado.ts");
  writeFileSync(destino, conteudo);
  console.log(`✓ ${destino} — ${estados.length} UFs, ${(conteudo.length / 1024).toFixed(0)} KB, limites ${JSON.stringify(limites)}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
