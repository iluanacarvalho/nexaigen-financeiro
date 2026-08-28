// Testes de diagnosticarNota() e calcularDataLimitePagamento() — funções puras
// (sem I/O, sem banco), fáceis de testar isoladamente. Cobrem os limiares
// definidos em lib/prazos.ts: LIMIAR_SEM_ATESTO_DIAS (20), LIMIAR_AVISO_VENCIMENTO_DIAS
// (5) e LIMIAR_ATRASO_CRITICO_DIAS (60), além do prazo legal de 30 dias
// (Lei 14.133/2021, Art. 141).

import { describe, it, expect } from "vitest";
import { diagnosticarNota, calcularDataLimitePagamento, type EstadoNota } from "./prazos";

describe("calcularDataLimitePagamento", () => {
  it("soma 30 dias corridos à data de atesto", () => {
    expect(calcularDataLimitePagamento("2026-01-01")).toBe("2026-01-31");
  });
});

describe("diagnosticarNota", () => {
  const base: EstadoNota = {
    temAtesto: false,
    temPagamento: false,
    dataEmissao: "2026-01-01",
    dataAtesto: null,
    dataLimitePagamento: null
  };

  it("nota paga sempre retorna status 'paga', mesmo com outros campos preenchidos", () => {
    const r = diagnosticarNota({ ...base, temPagamento: true });
    expect(r.statusDerivado).toBe("paga");
    expect(r.deveGerarAlerta).toBeNull();
  });

  it("sem atesto e dentro do limiar de 20 dias não gera alerta", () => {
    const hoje = new Date("2026-01-10"); // 9 dias sem atesto
    const r = diagnosticarNota(base, hoje);
    expect(r.statusDerivado).toBe("aguardando_atesto");
    expect(r.deveGerarAlerta).toBeNull();
  });

  it("sem atesto após 20 dias gera alerta sem_atesto_prolongado", () => {
    const hoje = new Date("2026-01-25"); // 24 dias sem atesto
    const r = diagnosticarNota(base, hoje);
    expect(r.statusDerivado).toBe("atesto_atrasado");
    expect(r.deveGerarAlerta).toBe("sem_atesto_prolongado");
  });

  it("com atesto e longe do vencimento não gera alerta", () => {
    const nota: EstadoNota = { ...base, temAtesto: true, dataAtesto: "2026-01-01" }; // limite = 2026-01-31
    const hoje = new Date("2026-01-10"); // 21 dias para vencer
    const r = diagnosticarNota(nota, hoje);
    expect(r.statusDerivado).toBe("atestada_aguardando_pagamento");
    expect(r.deveGerarAlerta).toBeNull();
  });

  it("avisa a partir de 5 dias antes do vencimento", () => {
    const nota: EstadoNota = { ...base, temAtesto: true, dataAtesto: "2026-01-01" }; // limite = 2026-01-31
    const hoje = new Date("2026-01-27"); // 4 dias antes
    const r = diagnosticarNota(nota, hoje);
    expect(r.statusDerivado).toBe("vencendo_em_breve");
    expect(r.deveGerarAlerta).toBe("proximo_vencimento");
  });

  it("gera alerta 'vencido' logo após passar do limite de pagamento", () => {
    const nota: EstadoNota = { ...base, temAtesto: true, dataAtesto: "2026-01-01" }; // limite = 2026-01-31
    const hoje = new Date("2026-02-05"); // 5 dias de atraso
    const r = diagnosticarNota(nota, hoje);
    expect(r.statusDerivado).toBe("vencida");
    expect(r.deveGerarAlerta).toBe("vencido");
  });

  it("gera alerta crítico (aciona cobrança) após 60 dias de atraso", () => {
    const nota: EstadoNota = { ...base, temAtesto: true, dataAtesto: "2026-01-01" }; // limite = 2026-01-31
    const hoje = new Date("2026-04-05"); // 64 dias de atraso
    const r = diagnosticarNota(nota, hoje);
    expect(r.statusDerivado).toBe("atraso_critico");
    expect(r.deveGerarAlerta).toBe("atraso_60_dias");
  });
});
