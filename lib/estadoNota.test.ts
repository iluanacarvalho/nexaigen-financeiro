// Testes unitários de lib/estadoNota.ts — puros, "hoje" fixo (2026-10-29).

import { describe, expect, it } from "vitest";
import {
  acoesPermitidas,
  dataIsoValida,
  faseDaNota,
  faseDaSituacao,
  lerMotivoObrigatorio,
  lerValorMonetario,
  normalizarCompetencia,
  situacaoDaNota,
  somarDias,
  statusAposAcao,
  validarCompetencia,
  validarDataEmissao,
  validarDataEvento,
  validarTransicao,
  type AcaoNota,
  type EstadoBasicoNota,
  type FaseNota
} from "./estadoNota";
import { centavosParaNumeric } from "./dinheiro";

const HOJE = "2026-10-29";
const base = (extra: Partial<EstadoBasicoNota> = {}): EstadoBasicoNota => ({
  status: "aguardando_atesto",
  data_emissao: "2026-10-20",
  data_atesto: null,
  data_limite_pagamento: null,
  data_pagamento: null,
  ...extra
});

describe("validarTransicao — matriz completa fase × ação", () => {
  const esperado: Record<FaseNota, Record<AcaoNota, boolean>> = {
    sem_atesto: { registrar_atesto: true, registrar_pagamento: false, cancelar: true, reabrir_pagamento: false },
    atestada: { registrar_atesto: false, registrar_pagamento: true, cancelar: true, reabrir_pagamento: false },
    paga: { registrar_atesto: false, registrar_pagamento: false, cancelar: false, reabrir_pagamento: true },
    cancelada: { registrar_atesto: false, registrar_pagamento: false, cancelar: false, reabrir_pagamento: false }
  };

  for (const [fase, acoes] of Object.entries(esperado) as [FaseNota, Record<AcaoNota, boolean>][]) {
    for (const [acao, permitido] of Object.entries(acoes) as [AcaoNota, boolean][]) {
      it(`${fase} + ${acao} → ${permitido ? "permitido" : "recusado"}`, () => {
        const r = validarTransicao(fase, acao);
        expect(r.ok).toBe(permitido);
        if (!r.ok) expect(r.erro.length).toBeGreaterThan(10);
      });
    }
  }

  it("mensagens específicas dos casos que a regra de negócio pede", () => {
    expect(validarTransicao("cancelada", "registrar_pagamento")).toEqual({ ok: false, erro: "Não é possível pagar uma nota cancelada." });
    expect(validarTransicao("paga", "cancelar")).toMatchObject({ ok: false, erro: expect.stringMatching(/reabra o pagamento/) });
    expect(validarTransicao("sem_atesto", "registrar_pagamento")).toMatchObject({ ok: false, erro: expect.stringMatching(/atesto antes/) });
  });

  it("acoesPermitidas bate com a matriz", () => {
    expect(acoesPermitidas("sem_atesto")).toEqual(["registrar_atesto", "cancelar"]);
    expect(acoesPermitidas("atestada")).toEqual(["registrar_pagamento", "cancelar"]);
    expect(acoesPermitidas("paga")).toEqual(["reabrir_pagamento"]);
    expect(acoesPermitidas("cancelada")).toEqual([]);
  });
});

describe("fase", () => {
  it.each([
    [base(), "sem_atesto"],
    [base({ status: "emitida" }), "sem_atesto"],
    [base({ data_atesto: "2026-10-21", status: "vencida" }), "atestada"],
    [base({ data_atesto: "2026-10-21", data_pagamento: "2026-10-25", status: "paga" }), "paga"],
    [base({ status: "cancelada", data_atesto: "2026-10-21" }), "cancelada"]
  ] as const)("faseDaNota %#", (nota, fase) => {
    expect(faseDaNota(nota)).toBe(fase);
  });

  it.each([
    ["aguardando_atesto", "sem_atesto"],
    ["emitida", "sem_atesto"],
    ["atestada", "atestada"],
    ["vencida", "atestada"],
    ["atraso_critico", "atestada"],
    ["paga", "paga"],
    ["cancelada", "cancelada"]
  ] as const)("faseDaSituacao(%s) → %s", (situacao, fase) => {
    expect(faseDaSituacao(situacao)).toBe(fase);
  });
});

describe("situacaoDaNota — pela data de hoje, não pela coluna status", () => {
  it.each([
    ["sem atesto", base(), "aguardando_atesto"],
    ["atestada no prazo (limite 2026-11-20)", base({ data_atesto: "2026-10-21", data_limite_pagamento: "2026-11-20", status: "atestada" }), "atestada"],
    ["vencida há 10 dias, status gravado ainda 'atestada'", base({ data_atesto: "2026-09-19", data_limite_pagamento: "2026-10-19", status: "atestada" }), "vencida"],
    ["60 dias de atraso → crítico", base({ data_atesto: "2026-07-31", data_limite_pagamento: "2026-08-30", status: "vencida" }), "atraso_critico"],
    ["limite nulo cai em atesto + 30", base({ data_atesto: "2026-09-19", data_limite_pagamento: null, status: "atestada" }), "vencida"],
    ["paga", base({ data_atesto: "2026-09-19", data_pagamento: "2026-10-01", status: "paga" }), "paga"],
    ["cancelada vence tudo", base({ status: "cancelada", data_atesto: "2026-01-01" }), "cancelada"]
  ] as const)("%s", (_d, nota, situacao) => {
    expect(situacaoDaNota(nota, HOJE)).toBe(situacao);
  });
});

describe("statusAposAcao", () => {
  it("atesto retroativo de 90 dias já nasce atraso_critico", () => {
    expect(statusAposAcao(base(), "registrar_atesto", "2026-07-31", HOJE)).toBe("atraso_critico");
  });
  it("atesto de hoje → atestada", () => {
    expect(statusAposAcao(base(), "registrar_atesto", HOJE, HOJE)).toBe("atestada");
  });
  it("pagamento → paga; cancelar → cancelada", () => {
    expect(statusAposAcao(base({ data_atesto: "2026-10-21" }), "registrar_pagamento", HOJE, HOJE)).toBe("paga");
    expect(statusAposAcao(base(), "cancelar", null, HOJE)).toBe("cancelada");
  });
  it("reabrir pagamento volta à situação pelas datas (aqui: vencida)", () => {
    const paga = base({ data_atesto: "2026-09-19", data_limite_pagamento: "2026-10-19", data_pagamento: "2026-10-20", status: "paga" });
    expect(statusAposAcao(paga, "reabrir_pagamento", null, HOJE)).toBe("vencida");
  });
});

describe("datas", () => {
  it.each([
    ["2026-10-29", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-13-01", false],
    ["2026-10-1", false],
    ["29/10/2026", false]
  ])("dataIsoValida(%s) → %s", (v, ok) => {
    expect(dataIsoValida(v)).toBe(ok);
  });

  it("somarDias cruza mês e ano em UTC", () => {
    expect(somarDias("2026-12-15", 30)).toBe("2027-01-14");
  });

  it("validarDataEvento: futuro, antes da mínima, inválida", () => {
    const limites = { hoje: HOJE, minima: "2026-10-20", rotuloMinima: "data de emissão" };
    expect(validarDataEvento("2026-10-25", limites)).toBeNull();
    expect(validarDataEvento("2026-10-30", limites)).toMatch(/futuro/);
    expect(validarDataEvento("2026-10-19", limites)).toMatch(/anterior à data de emissão/);
    expect(validarDataEvento("2026-02-30", limites)).toMatch(/inválida/);
  });

  it("validarDataEmissao", () => {
    expect(validarDataEmissao("2026-10-29", HOJE)).toBeNull();
    expect(validarDataEmissao("2026-10-30", HOJE)).toMatch(/futuro/);
    expect(validarDataEmissao("1999-12-31", HOJE)).toMatch(/2000/);
  });
});

describe("competência", () => {
  it.each([
    ["2026-10", "2026-10-01"],
    ["2026-10-17", "2026-10-01"],
    [" 2026-01 ", "2026-01-01"],
    ["2026-13", null],
    ["2026-02-30", null],
    ["10/2026", null]
  ])("normalizarCompetencia(%j) → %s", (v, esperado) => {
    expect(normalizarCompetencia(v)).toBe(esperado);
  });

  it("validarCompetencia: até o mês seguinte ao de hoje, a partir de 2000", () => {
    expect(validarCompetencia("2026-11-01", HOJE)).toBeNull();
    expect(validarCompetencia("2026-12-01", HOJE)).toMatch(/futuro/);
    expect(validarCompetencia("1999-12-01", HOJE)).toMatch(/2000/);
  });
});

describe("lerValorMonetario — texto, nunca float", () => {
  it.each([
    ["1500", 150000],
    ["1500.5", 150050],
    ["1500,50", 150050],
    ["0,01", 1],
    ["9999999999.99", 999999999999]
  ])("%s → %i centavos", (v, c) => {
    expect(lerValorMonetario(v)).toEqual({ ok: true, centavos: c });
  });

  it.each(["0", "0,00", "-10", "1.500,00", "10,123", "abc", "", "1e3", "12345678901"])("%j → inválido", (v) => {
    expect(lerValorMonetario(v).ok).toBe(false);
  });

  it("0.1 + 0.2 exatos em centavos e volta pro numeric sem erro de arredondamento", () => {
    const a = lerValorMonetario("0.10");
    const b = lerValorMonetario("0.20");
    if (!a.ok || !b.ok) throw new Error("inesperado");
    expect(centavosParaNumeric(a.centavos + b.centavos)).toBe("0.30");
    expect(centavosParaNumeric(999999999999)).toBe("9999999999.99");
  });
});

describe("lerMotivoObrigatorio", () => {
  it("obrigatório, aparado, até 300", () => {
    expect(lerMotivoObrigatorio("  NF emitida em duplicidade ")).toEqual({ ok: true, motivo: "NF emitida em duplicidade" });
    expect(lerMotivoObrigatorio("   ").ok).toBe(false);
    expect(lerMotivoObrigatorio(undefined).ok).toBe(false);
    expect(lerMotivoObrigatorio("a".repeat(300)).ok).toBe(true);
    expect(lerMotivoObrigatorio("a".repeat(301)).ok).toBe(false);
  });
});
