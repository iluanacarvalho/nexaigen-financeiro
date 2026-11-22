// lib/extenso.ts — valor (R$, centavos) e data por extenso em pt-BR, e CNPJ (lib/cnpj.ts).

import { describe, expect, it } from "vitest";
import { dataPorExtenso, formatarReais, inteiroPorExtenso, valorPorExtenso } from "./extenso";
import { cnpjValido, formatarCep, formatarCnpj, somenteDigitos } from "./cnpj";

describe("valor por extenso (centavos)", () => {
  it.each([
    [0, "zero real"],
    [100, "um real"],
    [2100, "vinte e um reais"],
    [10000, "cem reais"],
    [10100, "cento e um reais"],
    [100000, "mil reais"],
    [110000, "mil e cem reais"],
    [102000, "mil e vinte reais"],
    [545700, "cinco mil, quatrocentos e cinquenta e sete reais"],
    [850000, "oito mil e quinhentos reais"],
    [1500000, "quinze mil reais"],
    [3500000, "trinta e cinco mil reais"],
    [1, "um centavo"],
    [50, "cinquenta centavos"],
    [545730, "cinco mil, quatrocentos e cinquenta e sete reais e trinta centavos"],
    [101, "um real e um centavo"],
    [100000000, "um milhão de reais"],
    [200000000, "dois milhões de reais"],
    [150000000, "um milhão e quinhentos mil reais"],
    [123456789, "um milhão, duzentos e trinta e quatro mil, quinhentos e sessenta e sete reais e oitenta e nove centavos"]
  ] as const)("%i centavos → %s", (centavos, texto) => {
    expect(valorPorExtenso(centavos)).toBe(texto);
  });

  it("inteiros e limites", () => {
    expect(inteiroPorExtenso(1000000)).toBe("um milhão");
    expect(inteiroPorExtenso(1001)).toBe("mil e um");
    expect(inteiroPorExtenso(999)).toBe("novecentos e noventa e nove");
    expect(() => valorPorExtenso(-1)).toThrow();
    expect(() => valorPorExtenso(1.5)).toThrow();
  });

  it("formato em reais sem depender de Intl", () => {
    expect(formatarReais(545700)).toBe("R$ 5.457,00");
    expect(formatarReais(123456789)).toBe("R$ 1.234.567,89");
    expect(formatarReais(5)).toBe("R$ 0,05");
  });
});

describe("data por extenso", () => {
  it("dia, mês em português, ano; dia 1 com ordinal", () => {
    expect(dataPorExtenso("2026-11-21")).toBe("21 de novembro de 2026");
    expect(dataPorExtenso("2026-03-01")).toBe("1º de março de 2026");
    expect(() => dataPorExtenso("21/11/2026")).toThrow();
  });
});

describe("CNPJ e CEP", () => {
  it("dígitos verificadores (com e sem pontuação); todos iguais e tamanho errado são inválidos", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11222333000181")).toBe(true);
    expect(cnpjValido("11.222.333/0001-82")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
    expect(cnpjValido("1122233300018")).toBe(false);
    expect(cnpjValido("")).toBe(false);
    expect(somenteDigitos("11.222.333/0001-81")).toBe("11222333000181");
    expect(formatarCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatarCep("86010000")).toBe("86010-000");
  });
});
