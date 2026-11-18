// lib/geracaoMapaBrasil.ts — a parte pura do gerador do mapa, SEM rede,
// com a fixture de 3 estados falsos (testes/fixtures/malha-3-estados.json:
// PR com um ponto que some no arredondamento, SC em MultiPolygon, RS — fora
// de ordem no arquivo). Os paths esperados foram calculados À PARTE, com a
// fórmula escrita de novo (não com o código testado). E o arquivo
// realmente versionado (lib/mapaBrasil.gerado.ts): 27 UFs, válido.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anelParaPath, calcularLimites, gerarArquivoMapaBrasil, lerMalhaPorUf, montarMapaBrasil } from "./geracaoMapaBrasil";
import { MAPA_BRASIL } from "./mapaBrasil.gerado";

const FIXTURE = JSON.parse(readFileSync(join(process.cwd(), "testes", "fixtures", "malha-3-estados.json"), "utf-8"));
const opcoes = { exigirTodasAsUfs: false };

describe("montarMapaBrasil (fixture de 3 estados)", () => {
  it("saída exata: limites (faixa válida + margem), altura e paths — ordem estável por UF, ponto repetido some", () => {
    expect(montarMapaBrasil(FIXTURE, opcoes)).toEqual({
      largura: 1000,
      altura: 873,
      limites: { lonMin: -74.5, lonMax: -27.5, latMin: -34.5, latMax: 6.5 },
      estados: [
        { uf: "PR", d: "M521.3 670.2L542.6 670.2L542.6 648.9L521.3 648.9L521.3 670.2Z" },
        { uf: "RS", d: "M436.2 776.6L478.7 776.6L478.7 734L436.2 734L436.2 776.6Z" },
        { uf: "SC", d: "M500 712.8L521.3 712.8L521.3 691.5L500 691.5L500 712.8ZM551.1 725.5L555.3 725.5L555.3 721.3L551.1 725.5Z" }
      ]
    });
  });

  it("determinístico e idempotente: mesma entrada → mesmo texto; ordem das feições no arquivo não importa", () => {
    const a = gerarArquivoMapaBrasil(FIXTURE, "https://exemplo.invalid/malha", opcoes);
    const b = gerarArquivoMapaBrasil(structuredClone(FIXTURE), "https://exemplo.invalid/malha", opcoes);
    const invertida = { ...FIXTURE, features: [...FIXTURE.features].reverse() };
    expect(b).toBe(a);
    expect(gerarArquivoMapaBrasil(invertida, "https://exemplo.invalid/malha", opcoes)).toBe(a);
    expect(a.startsWith("// GERADO por scripts/gerar-mapa-brasil.ts")).toBe(true);
    expect(a).toContain("// Fonte: https://exemplo.invalid/malha");
    expect(a).toContain('"uf": "PR"');
  });

  it("bounding box: dentro da faixa válida, os limites são a faixa + margem; ponto além da faixa ESTENDE o limite (sempre pra fora, 1 casa)", () => {
    expect(calcularLimites([[-50, -25]])).toEqual({ lonMin: -74.5, lonMax: -27.5, latMin: -34.5, latMax: 6.5 });
    expect(calcularLimites([[-50, -25], [-75.04, 7.01], [-20.01, -35.5]])).toEqual({ lonMin: -75.6, lonMax: -19.5, latMin: -36, latMax: 7.6 });
  });

  it("simplificação: pontos consecutivos iguais depois do arredondamento saem", () => {
    const limites = { lonMin: -74.5, lonMax: -27.5, latMin: -34.5, latMax: 6.5 };
    expect(anelParaPath([[-50, -25], [-50.0001, -25.0001], [-49, -25], [-50, -25]], limites)).toBe("M521.3 670.2L542.6 670.2L521.3 670.2Z");
  });

  it.each([
    ["não é FeatureCollection", { type: "Feature" }, /FeatureCollection/],
    ["UF desconhecida", { type: "FeatureCollection", features: [{ properties: { codarea: "99" }, geometry: FIXTURE.features[0].geometry }] }, /código de UF desconhecido: "99"/],
    ["UF repetida", { type: "FeatureCollection", features: [FIXTURE.features[0], FIXTURE.features[0]] }, /UF repetida: RS/],
    ["geometria errada", { type: "FeatureCollection", features: [{ properties: { codarea: "41" }, geometry: { type: "Point", coordinates: [-50, -25] } }] }, /PR: geometria "Point"/],
    ["coordenada não numérica", { type: "FeatureCollection", features: [{ properties: { codarea: "41" }, geometry: { type: "Polygon", coordinates: [[[-50, -25], ["x", -25], [-49, -24], [-50, -25]]] } }] }, /coordenada não numérica/],
    ["anel curto", { type: "FeatureCollection", features: [{ properties: { codarea: "41" }, geometry: { type: "Polygon", coordinates: [[[-50, -25], [-49, -24], [-50, -25]]] } }] }, /menos de 4 pontos/],
    ["vazia", { type: "FeatureCollection", features: [] }, /nenhuma UF/]
  ])("rejeita malha inválida: %s", (_d, malha, mensagem) => {
    expect(() => montarMapaBrasil(malha, opcoes)).toThrow(mensagem);
  });

  it("o arquivo real exige as 27 UFs (a fixture de 3 é recusada sem a opção de teste)", () => {
    expect(() => gerarArquivoMapaBrasil(FIXTURE, "x")).toThrow(/esperava 27 UFs, veio 3/);
    expect(lerMalhaPorUf(FIXTURE, false).map((e) => e.uf)).toEqual(["RS", "PR", "SC"]);
  });
});

describe("lib/mapaBrasil.gerado.ts (o arquivo versionado)", () => {
  it("27 UFs distintas, em ordem, cada uma com path SVG válido, e sem nenhuma URL no desenho", () => {
    const ufs = MAPA_BRASIL.estados.map((e) => e.uf);
    expect(ufs).toHaveLength(27);
    expect(new Set(ufs).size).toBe(27);
    expect([...ufs].sort((a, b) => a.localeCompare(b))).toEqual(ufs);
    for (const e of MAPA_BRASIL.estados) expect(e.d).toMatch(/^(M[\d. ]+(L[\d. ]+)*Z)+$/);
    expect(JSON.stringify(MAPA_BRASIL.estados)).not.toMatch(/https?:/);
    expect(MAPA_BRASIL.limites).toEqual({ lonMin: -74.5, lonMax: -27.5, latMin: -34.5, latMax: 6.5 });
  });
});
