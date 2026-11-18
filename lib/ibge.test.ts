// lib/ibge.ts — validação do código, UF pelo código, centroide de área com
// valores conhecidos, conferência nome/UF e a consulta com fetch FALSO
// (fixtures reais da API de localidades em testes/fixtures/ibge — nenhuma
// chamada de rede: o setup vitest.setup.sem-apis-externas.ts bloquearia).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buscarMunicipioIbge, centroide, codigoIbgeValido, municipioConfere, normalizarNome, posicaoNoBrasil, ufDoCodigoIbge, type Fetch } from "./ibge";

const fixture = (nome: string) => JSON.parse(readFileSync(join(process.cwd(), "testes", "fixtures", "ibge", nome), "utf-8"));

describe("código IBGE", () => {
  it("exatamente 7 dígitos", () => {
    expect(codigoIbgeValido("4106902")).toBe(true);
    for (const ruim of ["410690", "41069021", "41069O2", " 4106902", "", "4106902\n"]) expect(codigoIbgeValido(ruim)).toBe(false);
  });
  it("UF pelos 2 primeiros dígitos (sem rede)", () => {
    expect(ufDoCodigoIbge("4106902")).toBe("PR");
    expect(ufDoCodigoIbge("5300108")).toBe("DF");
    expect(ufDoCodigoIbge("9999999")).toBeNull();
  });
});

describe("centroide de área", () => {
  it("quadrado 2×2 → centro exato; orientação do anel não importa; anel aberto é fechado", () => {
    const horario = { type: "Polygon", coordinates: [[[-50, -20], [-50, -18], [-48, -18], [-48, -20], [-50, -20]]] };
    const antiHorario = { type: "Polygon", coordinates: [[[-50, -20], [-48, -20], [-48, -18], [-50, -18], [-50, -20]]] };
    const aberto = { type: "Polygon", coordinates: [[[-50, -20], [-48, -20], [-48, -18], [-50, -18]]] };
    for (const g of [horario, antiHorario, aberto]) expect(centroide(g)).toEqual({ lon: -49, lat: -19 });
  });

  it("é de ÁREA, não média de vértices: triângulo (0,0)(6,0)(0,3) deslocado → (2,1) + deslocamento", () => {
    const tri = { type: "Polygon", coordinates: [[[-50, -20], [-44, -20], [-50, -17], [-50, -20]]] };
    expect(centroide(tri)).toEqual({ lon: -48, lat: -19 });
  });

  it("buraco subtrai; MultiPolygon e FeatureCollection somam por área", () => {
    // quadrado 4×4 em [0,4]² com buraco 2×2 em [2,4]×[2,4] → área 12, centroide (5/3, 5/3)
    const comBuraco = { type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]] };
    const c = centroide(comBuraco)!;
    expect(c.lon).toBeCloseTo(5 / 3, 12);
    expect(c.lat).toBeCloseTo(5 / 3, 12);
    // dois quadrados unitários em x∈[0,1] e x∈[3,4] → centro x=2, y=0.5
    const multi = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], [[[3, 0], [4, 0], [4, 1], [3, 1], [3, 0]]]] } }] };
    expect(centroide(multi)).toEqual({ lon: 2, lat: 0.5 });
  });

  it("sem área ou formato inválido → null", () => {
    expect(centroide({ type: "Polygon", coordinates: [[[0, 0], [1, 1], [2, 2], [0, 0]]] })).toBeNull();
    expect(centroide({ type: "Point", coordinates: [0, 0] })).toBeNull();
    expect(centroide(null)).toBeNull();
  });

  it("posicaoNoBrasil: 6 casas e faixa do território (inclui Fernando de Noronha)", () => {
    expect(posicaoNoBrasil({ lat: -25.4778914, lon: -49.2882333 })).toEqual({ lat: -25.477891, lon: -49.288233 });
    expect(posicaoNoBrasil({ lat: -3.85, lon: -32.42 })).toEqual({ lat: -3.85, lon: -32.42 });
    expect(posicaoNoBrasil({ lat: 40, lon: -3 })).toBeNull();
  });
});

describe("confere com o cadastro", () => {
  it("ignora prefixo, acento e caixa; UF tem que bater", () => {
    expect(normalizarNome("  São  João d'Aliança ")).toBe("sao joao d alianca");
    expect(municipioConfere({ nome: "Prefeitura Municipal de Jaguapitã", uf: "PR" }, { nome: "Jaguapitã", uf: "PR" })).toBe(true);
    expect(municipioConfere({ nome: "Município de São Paulo", uf: "sp" }, { nome: "São Paulo", uf: "SP" })).toBe(true);
    expect(municipioConfere({ nome: "Prefeitura de Curitiba", uf: "SC" }, { nome: "Curitiba", uf: "PR" })).toBe(false);
    expect(municipioConfere({ nome: "Prefeitura de Londrina", uf: "PR" }, { nome: "Curitiba", uf: "PR" })).toBe(false);
  });
});

function fetchFalso(rotas: Record<string, () => Response | Promise<Response>>): { fetch: Fetch; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url: string) => {
      urls.push(url);
      const chave = Object.keys(rotas).find((k) => url.includes(k));
      if (!chave) throw new Error(`rota não prevista: ${url}`);
      return rotas[chave]();
    }
  };
}
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const QUADRADO_CURITIBA = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[[-49.4, -25.6], [-49.2, -25.6], [-49.2, -25.4], [-49.4, -25.4], [-49.4, -25.6]]] } }] };

describe("buscarMunicipioIbge (fetch falso, fixtures reais)", () => {
  it("ok: nome/UF da API de localidades + centroide da malha; URLs oficiais", async () => {
    const f = fetchFalso({ "/v1/localidades/municipios/4106902": () => json(fixture("municipio-4106902.json")), "/v3/malhas/municipios/4106902": () => json(QUADRADO_CURITIBA) });
    expect(await buscarMunicipioIbge("4106902", f.fetch)).toEqual({ status: "ok", nome: "Curitiba", uf: "PR", posicao: { lat: -25.5, lon: -49.3 } });
    expect(f.urls).toEqual([
      "https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4106902",
      "https://servicodados.ibge.gov.br/api/v3/malhas/municipios/4106902?formato=application/vnd.geo%2Bjson"
    ]);
  });

  it("município novo sem microrregião (resposta real): UF pela região imediata; malha com erro → posição pendente", async () => {
    const f = fetchFalso({ "/v1/localidades/municipios/5101837": () => json(fixture("municipio-5101837.json")), "/v3/malhas/": () => json({ statusCode: 500 }, 500) });
    expect(await buscarMunicipioIbge("5101837", f.fetch)).toEqual({ status: "ok", nome: "Boa Esperança do Norte", uf: "MT", posicao: null });
  });

  it("código que o IBGE não conhece (resposta `[]`) → nao_encontrado; formato inválido nem consulta", async () => {
    const f = fetchFalso({ "/v1/localidades/municipios/9999999": () => json([]) });
    expect(await buscarMunicipioIbge("9999999", f.fetch)).toEqual({ status: "nao_encontrado" });
    const g = fetchFalso({});
    expect(await buscarMunicipioIbge("123", g.fetch)).toEqual({ status: "nao_encontrado" });
    expect(g.urls).toEqual([]);
  });

  it("NUNCA lança: rede caída, HTTP 503, JSON quebrado, tempo esgotado → indisponivel", async () => {
    const casos: (() => Response | Promise<Response>)[] = [
      () => Promise.reject(new TypeError("fetch failed")),
      () => json({ erro: 1 }, 503),
      () => new Response("<html>", { status: 200 }),
      () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
      () => json({ nome: 1 })
    ];
    for (const resposta of casos) {
      const f = fetchFalso({ "/v1/localidades/": resposta });
      await expect(buscarMunicipioIbge("4106902", f.fetch)).resolves.toEqual({ status: "indisponivel" });
    }
  });

  it("o fetch padrão (global) é bloqueado pra rede real nos testes — e mesmo assim não lança", async () => {
    await expect(buscarMunicipioIbge("4106902")).resolves.toEqual({ status: "indisponivel" });
  });
});
