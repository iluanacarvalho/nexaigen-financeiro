// lib/baseMunicipios.ts — montagem do JSON da UF a partir das respostas do
// IBGE (fixtures pequenas em testes/fixtures/, nada de rede) e a validação
// do arquivo commitado antes de importar.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codigoDaUf, lerPopulacaoIbge, montarBaseMunicipios, urlPopulacao, validarBaseMunicipios } from "./baseMunicipios";

const fixture = (nome: string) => JSON.parse(readFileSync(`testes/fixtures/${nome}`, "utf-8"));
const LOCALIDADES = fixture("ibge-localidades-mini.json");
const POPULACAO = fixture("ibge-populacao-mini.json");

describe("montarBaseMunicipios", () => {
  const base = montarBaseMunicipios("PR", LOCALIDADES, POPULACAO, "2026-11-18");

  it("ordena por código, usa o ano MAIS RECENTE da série e guarda micro/mesorregião", () => {
    expect(base.total).toBe(3);
    expect(base.municipios.map((m) => m.codigo_ibge)).toEqual(["4100103", "4113700", "4199999"]);
    expect(base.municipios[1]).toEqual({ codigo_ibge: "4113700", nome: "Londrina", populacao: 584465, populacao_ano: 2026, microrregiao: "Londrina", mesorregiao: "Norte Central Paranaense" });
    expect(base.fonte).toEqual({ localidades: "https://servicodados.ibge.gov.br/api/v1/localidades/estados/PR/municipios", populacao: urlPopulacao("PR"), consultado_em: "2026-11-18" });
  });

  it("população ausente ('...') fica null e entra em sem_populacao — nunca inventada; sem microrregião → null", () => {
    expect(base.municipios[2]).toMatchObject({ populacao: null, populacao_ano: null, microrregiao: null, mesorregiao: null });
    expect(base.sem_populacao).toEqual(["4199999"]);
  });

  it("resposta estranha → lança (melhor nenhum arquivo do que um errado)", () => {
    expect(() => montarBaseMunicipios("PR", [], POPULACAO, "2026-11-18")).toThrow(/vazia/);
    expect(() => montarBaseMunicipios("PR", [{ id: 123, nome: "X" }], POPULACAO, "2026-11-18")).toThrow(/7 dígitos/);
    expect(() => montarBaseMunicipios("PR", [{ id: 4205407, nome: "Florianópolis" }], POPULACAO, "2026-11-18")).toThrow(/não é de PR/);
    expect(() => montarBaseMunicipios("PR", [LOCALIDADES[0], LOCALIDADES[0]], POPULACAO, "2026-11-18")).toThrow(/repetido/);
    expect(() => montarBaseMunicipios("XX", LOCALIDADES, POPULACAO, "2026-11-18")).toThrow(/UF inválida/);
  });

  it("valores da API: só dígitos viram número", () => {
    expect(lerPopulacaoIbge("7201")).toBe(7201);
    for (const v of ["-", "...", "X", "", "12.5", null, 7201]) expect(lerPopulacaoIbge(v)).toBeNull();
    expect(codigoDaUf("PR")).toBe("41");
  });
});

describe("validarBaseMunicipios (arquivo commitado)", () => {
  it("arquivo bom → linhas prontas com nome_busca", () => {
    const r = validarBaseMunicipios(montarBaseMunicipios("PR", LOCALIDADES, POPULACAO, "2026-11-18"), "PR");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.municipios.find((m) => m.codigo_ibge === "4100103")).toMatchObject({ nome_busca: "abatia", uf: "PR" });
  });

  it("todos os erros de uma vez: UF, total, código, nome, população sem ano", () => {
    const r = validarBaseMunicipios(
      { uf: "SC", total: 5, municipios: [{ codigo_ibge: "41001", nome: "A" }, { codigo_ibge: "4100103", nome: "" }, { codigo_ibge: "4113700", nome: "Londrina", populacao: 10, populacao_ano: null }] },
      "PR"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros).toEqual([
      "O arquivo é de SC, não de PR.",
      "total = 5, mas a lista tem 3 municípios.",
      'municipios[0]: código IBGE "41001" não tem 7 dígitos.',
      "municipios[1]: sem nome.",
      "municipios[2]: população sem ano."
    ]);
  });

  it("o arquivo REAL do Paraná: 399 municípios, códigos de 7 dígitos, todos válidos", () => {
    const r = validarBaseMunicipios(JSON.parse(readFileSync("scripts/dados/municipios-PR.json", "utf-8")), "PR");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.municipios).toHaveLength(399);
      expect(r.municipios.every((m) => /^41[0-9]{5}$/.test(m.codigo_ibge))).toBe(true);
    }
  });
});
