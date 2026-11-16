// lib/planos.ts — os 4 planos, valores em centavos EXATOS, regra da Dispensa
// sem taxa e a regra de preço na criação (enviado vence; ausente = padrão).

import { describe, expect, it } from "vitest";
import {
  IDS_PLANOS,
  MENSAGEM_DISPENSA_SEM_TAXA,
  PLANOS,
  ehIdPlano,
  mensagemPlanoDescontinuado,
  obterPlano,
  precosDeCriacao,
  rotuloDoPlano,
  temImplantacao,
  temImplantacaoACobrar,
  valoresPadrao
} from "./planos";

describe("os 4 planos — valores exatos em centavos", () => {
  it.each([
    ["dispensa", "Dispensa", 545700, null, null],
    ["pequeno_porte", "Pequeno Porte", 850000, 1500000, "Até 50 mil hab."],
    ["medio_porte", "Médio Porte", 1500000, 2000000, "50 mil a 200 mil hab."],
    ["grande_porte", "Grande Porte", 3500000, 3000000, "Acima de 200 mil hab."]
  ] as const)("%s", (id, rotulo, mensal, taxa, faixa) => {
    expect(obterPlano(id)).toEqual({ id, rotulo, valorMensalCentavos: mensal, taxaImplantacaoCentavos: taxa, faixaHabitantes: faixa });
    expect(valoresPadrao(id)).toEqual({ valorMensalCentavos: mensal, taxaImplantacaoCentavos: taxa });
    expect(rotuloDoPlano(id)).toBe(rotulo);
    expect(temImplantacao(id)).toBe(taxa !== null);
  });

  it("exatamente 4 planos, na ordem do mais barato pro mais caro, todos inteiros", () => {
    expect(PLANOS.map((p) => p.id)).toEqual([...IDS_PLANOS]);
    for (const p of PLANOS) {
      expect(Number.isInteger(p.valorMensalCentavos)).toBe(true);
      if (p.taxaImplantacaoCentavos !== null) expect(Number.isInteger(p.taxaImplantacaoCentavos)).toBe(true);
    }
    expect(PLANOS.map((p) => p.valorMensalCentavos)).toEqual([545700, 850000, 1500000, 3500000]);
  });

  it("ids antigos e desconhecidos", () => {
    expect(ehIdPlano("essencial")).toBe(false);
    expect(ehIdPlano("completo")).toBe(false);
    expect(ehIdPlano("medio_porte")).toBe(true);
    expect(() => obterPlano("essencial")).toThrow(/desconhecido/);
    expect(rotuloDoPlano("algo")).toBe("algo");
    expect(mensagemPlanoDescontinuado("essencial")).toMatch(/descontinuado.*dispensa, pequeno_porte, medio_porte, grande_porte/);
  });
});

describe("precosDeCriacao", () => {
  it("nada enviado → padrões do plano", () => {
    expect(precosDeCriacao("medio_porte", {})).toEqual({ ok: true, valorMensalCentavos: 1500000, taxaImplantacaoCentavos: 2000000 });
    expect(precosDeCriacao("dispensa", {})).toEqual({ ok: true, valorMensalCentavos: 545700, taxaImplantacaoCentavos: null });
  });

  it("valor enviado vence o padrão (o combinado pode ser diferente)", () => {
    expect(precosDeCriacao("grande_porte", { valorMensalCentavos: 3200000, taxaImplantacaoCentavos: 2500000 })).toEqual({
      ok: true,
      valorMensalCentavos: 3200000,
      taxaImplantacaoCentavos: 2500000
    });
  });

  it("porte com taxa null explícito → sem implantação combinada (null, não o padrão)", () => {
    expect(precosDeCriacao("pequeno_porte", { taxaImplantacaoCentavos: null })).toEqual({ ok: true, valorMensalCentavos: 850000, taxaImplantacaoCentavos: null });
  });

  it("Dispensa com taxa enviada → erro; com taxa null → ok", () => {
    expect(precosDeCriacao("dispensa", { taxaImplantacaoCentavos: 100 })).toEqual({ ok: false, erro: MENSAGEM_DISPENSA_SEM_TAXA });
    expect(precosDeCriacao("dispensa", { taxaImplantacaoCentavos: null }).ok).toBe(true);
  });
});

describe("temImplantacaoACobrar", () => {
  const base = { status_contrato: "ativo", taxa_implantacao: "15000.00", tem_implantacao_ativa: false };
  it.each([
    ["ativo, com taxa, sem nota", base, true],
    ["já tem nota ativa", { ...base, tem_implantacao_ativa: true }, false],
    ["sem taxa (Dispensa / em branco)", { ...base, taxa_implantacao: null }, false],
    ["contrato em aviso prévio (segue normal até o término)", { ...base, status_contrato: "em_aviso_previo" }, true],
    ["contrato suspenso", { ...base, status_contrato: "suspenso" }, false],
    ["contrato encerrado", { ...base, status_contrato: "encerrado" }, false]
  ])("%s → %s", (_d, c, esperado) => {
    expect(temImplantacaoACobrar(c)).toBe(esperado);
  });
});

