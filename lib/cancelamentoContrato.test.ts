// lib/cancelamentoContrato.ts — término (pedido + 30), validações de
// registrar/retratar, períodos de 30 dias e a nota final proporcional em
// centavos inteiros, com as bordas pedidas: término no último dia do
// período (valor cheio), 1 dia, mudança de mês e de ano, ano bissexto.

import { describe, expect, it } from "vitest";
import {
  AVISO_PREVIO_DIAS,
  aceitaMensalidade,
  calcularTermino,
  competenciaAposTermino,
  competenciaNotaFinal,
  diasDoUltimoPeriodo,
  lerMotivoCancelamento,
  periodoQueContem,
  precisaNotaFinal,
  rotuloStatusContrato,
  statusContratoNaData,
  sugerirNotaFinal,
  ultimoPeriodo,
  validarPedido,
  validarRetratacao,
  valorNotaFinalCentavos
} from "./cancelamentoContrato";

describe("calcularTermino — pedido + 30 dias corridos", () => {
  it.each([
    ["2026-10-01", "2026-10-31"],
    ["2026-01-31", "2026-03-02"], // fevereiro de 28 dias
    ["2026-12-15", "2027-01-14"], // virada de ano
    ["2028-02-15", "2028-03-16"] // bissexto (29/02 conta)
  ])("%s → %s", (pedido, termino) => {
    expect(AVISO_PREVIO_DIAS).toBe(30);
    expect(calcularTermino(pedido)).toBe(termino);
  });
});

describe("validarPedido", () => {
  const base = { dataPedido: "2026-10-01", hoje: "2026-10-10", dataInicioContrato: "2026-01-01", statusContrato: "ativo" };

  it("ativo, data no passado e depois do início → ok com o término", () => {
    expect(validarPedido(base)).toEqual({ ok: true, termino: "2026-10-31" });
    expect(validarPedido({ ...base, dataPedido: "2026-10-10" }).ok).toBe(true); // hoje vale
    expect(validarPedido({ ...base, dataPedido: "2026-01-01" }).ok).toBe(true); // o próprio dia do início vale
  });

  it("no futuro, antes do início ou inválida → dados_invalidos", () => {
    expect(validarPedido({ ...base, dataPedido: "2026-10-11" })).toMatchObject({ ok: false, motivo: "dados_invalidos", erro: expect.stringMatching(/futuro/) });
    expect(validarPedido({ ...base, dataPedido: "2025-12-31" })).toMatchObject({ ok: false, motivo: "dados_invalidos", erro: expect.stringMatching(/01\/01\/2026/) });
    expect(validarPedido({ ...base, dataPedido: "2026-02-30" })).toMatchObject({ ok: false, motivo: "dados_invalidos" });
  });

  it.each(["em_aviso_previo", "suspenso", "encerrado"])("contrato %s → transicao_invalida (409)", (statusContrato) => {
    expect(validarPedido({ ...base, statusContrato })).toMatchObject({ ok: false, motivo: "transicao_invalida" });
  });
});

describe("validarRetratacao — até a data de término, inclusive", () => {
  it("antes e no dia do término → ok; no dia seguinte → 409", () => {
    expect(validarRetratacao({ statusContrato: "em_aviso_previo", termino: "2026-10-31", hoje: "2026-10-15" }).ok).toBe(true);
    expect(validarRetratacao({ statusContrato: "em_aviso_previo", termino: "2026-10-31", hoje: "2026-10-31" }).ok).toBe(true);
    expect(validarRetratacao({ statusContrato: "em_aviso_previo", termino: "2026-10-31", hoje: "2026-11-01" })).toMatchObject({
      ok: false,
      motivo: "transicao_invalida",
      erro: expect.stringMatching(/31\/10\/2026/)
    });
  });

  it.each(["ativo", "encerrado", "suspenso"])("contrato %s → nada a retratar (409)", (statusContrato) => {
    expect(validarRetratacao({ statusContrato, termino: null, hoje: "2026-10-15" })).toMatchObject({ ok: false, motivo: "transicao_invalida" });
  });
});

describe("lerMotivoCancelamento", () => {
  it("apara, vazio vira null, limite de 500", () => {
    expect(lerMotivoCancelamento("  Ofício 12/2026  ")).toEqual({ ok: true, motivo: "Ofício 12/2026" });
    expect(lerMotivoCancelamento("   ")).toEqual({ ok: true, motivo: null });
    expect(lerMotivoCancelamento(undefined)).toEqual({ ok: true, motivo: null });
    expect(lerMotivoCancelamento("x".repeat(500)).ok).toBe(true);
    expect(lerMotivoCancelamento("x".repeat(501)).ok).toBe(false);
  });
});

describe("statusContratoNaData — aviso vencido conta como encerrado mesmo antes do job", () => {
  it("término hoje ainda é aviso prévio; no dia seguinte, encerrado", () => {
    const c = { status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-10-31" };
    expect(statusContratoNaData(c, "2026-10-31")).toBe("em_aviso_previo");
    expect(statusContratoNaData(c, "2026-11-01")).toBe("encerrado");
    expect(statusContratoNaData({ status_contrato: "ativo" }, "2026-11-01")).toBe("ativo");
  });
});

describe("períodos de 30 dias contados do início do contrato", () => {
  it("período 0 e 1 (janeiro tem 31 dias, fevereiro 28)", () => {
    expect(periodoQueContem("2026-01-01", "2026-01-01")).toEqual({ numero: 0, inicio: "2026-01-01", fim: "2026-01-30" });
    expect(periodoQueContem("2026-01-01", "2026-01-30")).toEqual({ numero: 0, inicio: "2026-01-01", fim: "2026-01-30" });
    expect(periodoQueContem("2026-01-01", "2026-01-31")).toEqual({ numero: 1, inicio: "2026-01-31", fim: "2026-03-01" });
    expect(() => periodoQueContem("2026-01-01", "2025-12-31")).toThrow(/anterior/);
  });
});

describe("nota final proporcional — valor_mensal × dias ÷ 30, centavos inteiros", () => {
  it("término no ÚLTIMO dia do período → 30 dias = valor cheio", () => {
    expect(diasDoUltimoPeriodo("2026-01-01", "2026-01-30")).toBe(30);
    expect(valorNotaFinalCentavos(850000, "2026-01-01", "2026-01-30")).toBe(850000);
  });

  it("término no PRIMEIRO dia do período → 1 dia", () => {
    expect(diasDoUltimoPeriodo("2026-01-01", "2026-01-31")).toBe(1);
    expect(valorNotaFinalCentavos(850000, "2026-01-01", "2026-01-31")).toBe(28333); // 28.333,33… → 28.333
    expect(valorNotaFinalCentavos(545700, "2026-01-01", "2026-01-31")).toBe(18190); // exato
  });

  it("mudança de mês: período começa em 31/01, término 15/02 → 16 dias, competência de JANEIRO (mês em que o período começa)", () => {
    expect(ultimoPeriodo("2026-01-01", "2026-02-15")).toEqual({ numero: 1, inicio: "2026-01-31", fim: "2026-03-01" });
    expect(diasDoUltimoPeriodo("2026-01-01", "2026-02-15")).toBe(16);
    expect(valorNotaFinalCentavos(850000, "2026-01-01", "2026-02-15")).toBe(453333);
    expect(competenciaNotaFinal("2026-01-01", "2026-02-15")).toBe("2026-01-01");
  });

  it("mudança de ano: período 10/12/2026–08/01/2027, término 05/01/2027 → 27 dias, competência 12/2026", () => {
    expect(ultimoPeriodo("2026-12-10", "2027-01-05")).toEqual({ numero: 0, inicio: "2026-12-10", fim: "2027-01-08" });
    expect(diasDoUltimoPeriodo("2026-12-10", "2027-01-05")).toBe(27);
    expect(valorNotaFinalCentavos(1500000, "2026-12-10", "2027-01-05")).toBe(1350000);
    expect(competenciaNotaFinal("2026-12-10", "2027-01-05")).toBe("2026-12-01");
  });

  it("ano bissexto: período 01/02–01/03/2028 (29/02 existe)", () => {
    expect(ultimoPeriodo("2028-02-01", "2028-02-29")).toEqual({ numero: 0, inicio: "2028-02-01", fim: "2028-03-01" });
    expect(diasDoUltimoPeriodo("2028-02-01", "2028-02-29")).toBe(29);
    expect(valorNotaFinalCentavos(3500000, "2028-02-01", "2028-02-29")).toBe(3383333); // 3.383.333,33… → 3.383.333
    expect(diasDoUltimoPeriodo("2028-02-01", "2028-03-01")).toBe(30);
    expect(valorNotaFinalCentavos(3500000, "2028-02-01", "2028-03-01")).toBe(3500000);
    expect(diasDoUltimoPeriodo("2028-02-01", "2028-03-02")).toBe(1);
  });

  it("arredonda meio centavo pra cima, sem float", () => {
    expect(valorNotaFinalCentavos(15, "2026-01-01", "2026-01-31")).toBe(1); // 0,5 → 1
    expect(valorNotaFinalCentavos(45, "2026-01-01", "2026-01-31")).toBe(2); // 1,5 → 2
    expect(valorNotaFinalCentavos(44, "2026-01-01", "2026-01-31")).toBe(1); // 1,466… → 1
    expect(valorNotaFinalCentavos(999999999999, "2026-01-01", "2026-01-31")).toBe(33333333333); // grande, exato
    expect(() => valorNotaFinalCentavos(100.5, "2026-01-01", "2026-01-31")).toThrow(/centavos inteiros/);
  });

  it("sugerirNotaFinal junta competência, período, dias e valor", () => {
    expect(sugerirNotaFinal({ data_inicio_contrato: "2026-01-01", cancelamento_termino_em: "2026-02-15", valorMensalCentavos: 850000 })).toEqual({
      competencia: "2026-01-01",
      periodo: { numero: 1, inicio: "2026-01-31", fim: "2026-03-01" },
      dias: 16,
      valorCentavos: 453333
    });
  });
});

describe("bloqueio de mensalidade depois do término", () => {
  it("competência posterior à do último período → bloqueada; a do último período e anteriores → liberadas", () => {
    expect(competenciaAposTermino("2026-01-01", "2026-01-01", "2026-02-15")).toBe(false);
    expect(competenciaAposTermino("2025-12-01", "2026-01-01", "2026-02-15")).toBe(false);
    expect(competenciaAposTermino("2026-02-01", "2026-01-01", "2026-02-15")).toBe(true);
  });

  it("aceitaMensalidade: ativo, em aviso e encerrado POR AVISO PRÉVIO; nunca suspenso nem encerrado sem término", () => {
    expect(aceitaMensalidade({ status_contrato: "ativo" })).toBe(true);
    expect(aceitaMensalidade({ status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-10-31" })).toBe(true);
    expect(aceitaMensalidade({ status_contrato: "encerrado", cancelamento_termino_em: "2026-10-31" })).toBe(true);
    expect(aceitaMensalidade({ status_contrato: "encerrado", cancelamento_termino_em: null })).toBe(false);
    expect(aceitaMensalidade({ status_contrato: "suspenso" })).toBe(false);
  });

  it("precisaNotaFinal: só com término registrado e sem a nota do último período", () => {
    expect(precisaNotaFinal({ status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-10-31", nota_final_emitida: false })).toBe(true);
    expect(precisaNotaFinal({ status_contrato: "encerrado", cancelamento_termino_em: "2026-10-31", nota_final_emitida: false })).toBe(true);
    expect(precisaNotaFinal({ status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-10-31", nota_final_emitida: true })).toBe(false);
    expect(precisaNotaFinal({ status_contrato: "ativo", cancelamento_termino_em: null })).toBe(false);
  });
});

describe("rótulos em português", () => {
  it("todos os status + desconhecido", () => {
    expect(["ativo", "em_aviso_previo", "suspenso", "encerrado", "xyz"].map(rotuloStatusContrato)).toEqual(["Ativo", "Em aviso prévio", "Suspenso", "Encerrado", "xyz"]);
  });
});
