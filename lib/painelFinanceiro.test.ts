// Testes unitários de lib/painelFinanceiro.ts — funções puras, sem banco,
// sem rede. "Hoje" é sempre fixo (2026-10-29) pra todo número ser exato.

import { describe, expect, it } from "vitest";
import {
  calcularInadimplencia,
  calcularAvisoPrevio,
  calcularMrr,
  calcularPrazoMedioRecebimento,
  classificarSituacaoCliente,
  formatarMoeda,
  gerarCsvClientes,
  hojeEmSaoPaulo,
  mesesDaJanela,
  montarPainelFinanceiro,
  montarSerieMensal,
  neutralizarFormula,
  ordenarClientesPorAtraso,
  paraCentavos,
  type ClientePainel,
  type LinhaClientePainel,
  type LinhaNotaPainel
} from "./painelFinanceiro";

const HOJE = "2026-10-29";

function cliente(extra: Partial<LinhaClientePainel> = {}): LinhaClientePainel {
  return { id: "c1", nome: "Prefeitura A", uf: "PR", plano: "dispensa", valor_mensal: "1000.00", status_contrato: "ativo", ...extra };
}

let seq = 0;
function nota(extra: Partial<LinhaNotaPainel> = {}): LinhaNotaPainel {
  seq += 1;
  return {
    id: `n${seq}`,
    cliente_id: "c1",
    valor: "100.00",
    competencia: "2026-10-01",
    status: "aguardando_atesto",
    data_emissao: "2026-10-20",
    data_atesto: null,
    data_limite_pagamento: null,
    data_pagamento: null,
    ...extra
  };
}

describe("paraCentavos — sem erro de float", () => {
  it.each([
    ["4500.50", 450050],
    ["0.10", 10],
    ["0.29", 29],
    ["1234567890.99", 123456789099],
    ["10", 1000],
    ["10.5", 1050],
    ["-3.07", -307],
    ["1.005", 101]
  ])("%s → %i", (entrada, esperado) => {
    expect(paraCentavos(entrada)).toBe(esperado);
  });

  it("soma de 0.10 + 0.20 em centavos é exata (30), diferente de float (0.30000000000000004)", () => {
    expect(paraCentavos("0.10") + paraCentavos("0.20")).toBe(30);
  });

  it("valor não numérico lança — nunca vira 0 em silêncio", () => {
    expect(() => paraCentavos("abc")).toThrow(/inválido/);
  });

  it("formatarMoeda: null vira —", () => {
    expect(formatarMoeda(null)).toBe("—");
    expect(formatarMoeda(450050)).toMatch(/4\.500,50/);
  });
});

describe("datas — America/Sao_Paulo, mês civil", () => {
  it("02:30 UTC de 1º/nov ainda é 31/out em São Paulo (UTC-3)", () => {
    expect(hojeEmSaoPaulo(new Date("2026-11-01T02:30:00Z"))).toBe("2026-10-31");
    expect(hojeEmSaoPaulo(new Date("2026-11-01T03:30:00Z"))).toBe("2026-11-01");
  });

  it("janela de 12 meses atravessa a virada de ano", () => {
    expect(mesesDaJanela("2026-03-15")).toEqual([
      "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09",
      "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"
    ]);
  });
});

describe("calcularMrr", () => {
  const HOJE = "2026-10-29";
  it("soma ativos e EM AVISO PRÉVIO; conta ativos/em aviso/suspensos/encerrados", () => {
    const mrr = calcularMrr(
      [
        cliente({ id: "a", valor_mensal: "1000.10" }),
        cliente({ id: "b", valor_mensal: "2500.25" }),
        cliente({ id: "c", valor_mensal: "9999.00", status_contrato: "suspenso" }),
        cliente({ id: "d", valor_mensal: "5000.00", status_contrato: "encerrado" }),
        cliente({ id: "e", valor_mensal: "700.00", status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-11-10" })
      ],
      HOJE
    );
    expect(mrr).toEqual({ valorCentavos: 420035, contratos: { ativos: 2, emAvisoPrevio: 1, suspensos: 1, encerrados: 1 } });
  });

  it("aviso prévio entra no MRR ATÉ o término (inclusive) e sai no dia seguinte, mesmo antes do job diário", () => {
    const emAviso = [cliente({ id: "e", valor_mensal: "700.00", status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-10-29" })];
    expect(calcularMrr(emAviso, "2026-10-29")).toEqual({ valorCentavos: 70000, contratos: { ativos: 0, emAvisoPrevio: 1, suspensos: 0, encerrados: 0 } });
    expect(calcularMrr(emAviso, "2026-10-30")).toEqual({ valorCentavos: 0, contratos: { ativos: 0, emAvisoPrevio: 0, suspensos: 0, encerrados: 1 } });
  });

  it("sem nenhum cliente → valor null (—), não 0", () => {
    expect(calcularMrr([], HOJE).valorCentavos).toBeNull();
  });

  it("clientes existem mas nenhum ativo → 0 de verdade", () => {
    expect(calcularMrr([cliente({ status_contrato: "suspenso" })], HOJE).valorCentavos).toBe(0);
  });
});

describe("calcularAvisoPrevio", () => {
  it("quantidade, MRR em risco e o término mais próximo; vencidos não contam", () => {
    const clientes = [
      cliente({ id: "a", valor_mensal: "1000.10" }),
      cliente({ id: "b", valor_mensal: "700.00", status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-11-20" }),
      cliente({ id: "c", valor_mensal: "300.05", status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-11-05" }),
      cliente({ id: "d", valor_mensal: "999.00", status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-10-01" })
    ];
    expect(calcularAvisoPrevio(clientes, "2026-10-29")).toEqual({ quantidade: 2, mrrEmRiscoCentavos: 100005, proximoTermino: "2026-11-05" });
    expect(calcularAvisoPrevio([], "2026-10-29")).toEqual({ quantidade: 0, mrrEmRiscoCentavos: 0, proximoTermino: null });
  });
});

describe("calcularInadimplencia", () => {
  it("vencido / faturado, 1 casa decimal", () => {
    expect(calcularInadimplencia(1000, 3000).percentual).toBe(33.3);
    expect(calcularInadimplencia(0, 3000).percentual).toBe(0);
  });

  it("divisão por zero → null, nunca NaN/Infinity", () => {
    const r = calcularInadimplencia(0, 0);
    expect(r.percentual).toBeNull();
    expect(calcularInadimplencia(500, 0).percentual).toBeNull();
  });
});

describe("calcularPrazoMedioRecebimento", () => {
  it("média de dias emissão → pagamento das notas pagas na janela", () => {
    const notas = [
      nota({ data_emissao: "2026-09-01", data_pagamento: "2026-09-11", status: "paga" }), // 10
      nota({ data_emissao: "2026-08-01", data_pagamento: "2026-08-26", status: "paga" }), // 25
      nota({ data_emissao: "2024-01-01", data_pagamento: "2024-02-01", status: "paga" }), // fora da janela
      nota({ data_emissao: "2026-10-01" }) // não paga
    ];
    expect(calcularPrazoMedioRecebimento(notas, "2025-11-01", HOJE)).toBe(17.5);
  });

  it("sem nota paga na janela → null", () => {
    expect(calcularPrazoMedioRecebimento([nota()], "2025-11-01", HOJE)).toBeNull();
  });
});

describe("montarSerieMensal", () => {
  it("faturado por competência, recebido pelo mês do pagamento; mês sem dado = 0; sempre 12 pontos", () => {
    const meses = mesesDaJanela(HOJE);
    const serie = montarSerieMensal(
      [
        nota({ competencia: "2026-09-01", valor: "300.00", data_pagamento: "2026-10-05", status: "paga" }),
        nota({ competencia: "2026-10-01", valor: "200.00" }),
        nota({ competencia: "2026-10-01", valor: "999.00", status: "cancelada" }),
        nota({ competencia: "2020-01-01", valor: "50.00", data_pagamento: "2026-10-10", status: "paga" })
      ],
      meses
    );
    expect(serie).toHaveLength(12);
    expect(serie[0]).toEqual({ mes: "2025-11", faturadoCentavos: 0, recebidoCentavos: 0 });
    expect(serie.find((p) => p.mes === "2026-09")).toEqual({ mes: "2026-09", faturadoCentavos: 30000, recebidoCentavos: 0 });
    // recebido em out = 300 (competência set) + 50 (competência antiga, pago em out); cancelada ignorada
    expect(serie[11]).toEqual({ mes: "2026-10", faturadoCentavos: 20000, recebidoCentavos: 35000 });
  });
});

describe("classificarSituacaoCliente", () => {
  it.each([
    [0, "em_dia"],
    [1, "atencao"],
    [59, "atencao"],
    [60, "inadimplente"],
    [200, "inadimplente"]
  ] as const)("maior atraso %i dias → %s", (dias, esperado) => {
    expect(classificarSituacaoCliente(dias)).toBe(esperado);
  });
});

describe("montarPainelFinanceiro", () => {
  it("banco sem notas → semNotas, KPIs de nota null (—), série com 12 zeros, MRR ainda real", () => {
    const p = montarPainelFinanceiro({ clientes: [cliente()], notas: [], hoje: HOJE });
    expect(p.semNotas).toBe(true);
    expect(p.kpis.recebidoMesCentavos).toBeNull();
    expect(p.kpis.aReceber).toBeNull();
    expect(p.kpis.inadimplencia.percentual).toBeNull();
    expect(p.kpis.prazoMedioRecebimentoDias).toBeNull();
    expect(p.kpis.aguardandoAtestoMais15Dias).toBeNull();
    expect(p.kpis.mrr.valorCentavos).toBe(100000);
    expect(p.serie.every((s) => s.faturadoCentavos === 0 && s.recebidoCentavos === 0)).toBe(true);
    expect(p.clientes[0]).toMatchObject({ notasEmAberto: 0, maiorAtrasoDias: 0, situacao: "em_dia" });
  });

  it("banco totalmente vazio → MRR null também", () => {
    const p = montarPainelFinanceiro({ clientes: [], notas: [], hoje: HOJE });
    expect(p.kpis.mrr.valorCentavos).toBeNull();
    expect(p.clientes).toEqual([]);
  });

  it("deriva vencida/atraso crítico pela data de hoje (não pela coluna status gravada)", () => {
    const p = montarPainelFinanceiro({
      clientes: [cliente({ id: "c1" }), cliente({ id: "c2", nome: "Prefeitura B" })],
      notas: [
        // c1: atestada, limite 2026-10-19 → 10 dias de atraso → vencida (status gravado ainda "atestada")
        nota({ cliente_id: "c1", valor: "1000.00", status: "atestada", data_emissao: "2026-09-10", data_atesto: "2026-09-19", data_limite_pagamento: "2026-10-19", competencia: "2026-09-01" }),
        // c2: limite 2026-08-01 → 89 dias → atraso crítico
        nota({ cliente_id: "c2", valor: "2000.00", status: "vencida", data_emissao: "2026-06-20", data_atesto: "2026-07-02", data_limite_pagamento: "2026-08-01", competencia: "2026-06-01" }),
        // c2: aguardando atesto desde 2026-10-01 → 28 dias sem atesto (> 15)
        nota({ cliente_id: "c2", valor: "500.00", data_emissao: "2026-10-01", competencia: "2026-10-01" }),
        // c1: paga em outubro, emitida 2026-08-05 → 60 dias de prazo
        nota({ cliente_id: "c1", valor: "1000.00", status: "paga", data_emissao: "2026-08-05", data_atesto: "2026-08-10", data_limite_pagamento: "2026-09-09", data_pagamento: "2026-10-04", competencia: "2026-08-01" })
      ],
      hoje: HOJE
    });

    expect(p.semNotas).toBe(false);
    expect(p.kpis.recebidoMesCentavos).toBe(100000);
    expect(p.kpis.aReceber).toEqual({ totalCentavos: 350000, noPrazoCentavos: 50000, vencidasCentavos: 100000, atrasoCriticoCentavos: 200000 });
    // vencido 3000 / faturado 4500 = 66,7%
    expect(p.kpis.inadimplencia).toEqual({ percentual: 66.7, vencidoCentavos: 300000, faturadoCentavos: 450000 });
    expect(p.kpis.prazoMedioRecebimentoDias).toBe(60);
    expect(p.kpis.aguardandoAtestoMais15Dias).toBe(1);

    expect(p.clientes.map((c) => [c.id, c.notasEmAberto, c.valorEmAbertoCentavos, c.maiorAtrasoDias, c.situacao])).toEqual([
      ["c2", 2, 250000, 89, "inadimplente"],
      ["c1", 1, 100000, 10, "atencao"]
    ]);
  });

  it("notas canceladas não entram em nada", () => {
    const p = montarPainelFinanceiro({ clientes: [cliente()], notas: [nota({ status: "cancelada", valor: "999.00" })], hoje: HOJE });
    expect(p.semNotas).toBe(true);
    expect(p.clientes[0].notasEmAberto).toBe(0);
  });
});

describe("ordenarClientesPorAtraso", () => {
  const base = (id: string, atraso: number, nome = id): ClientePainel => ({
    id, nome, uf: "PR", plano: "dispensa", planoRotulo: "Dispensa", statusContrato: "ativo", terminoAvisoPrevio: null, valorMensalCentavos: 0, implantacaoACobrarCentavos: null,
    notasEmAberto: 0, valorEmAbertoCentavos: 0, maiorAtrasoDias: atraso, situacao: classificarSituacaoCliente(atraso)
  });

  it("desc (padrão) e asc", () => {
    const lista = [base("a", 5), base("b", 70), base("c", 0)];
    expect(ordenarClientesPorAtraso(lista).map((c) => c.id)).toEqual(["b", "a", "c"]);
    expect(ordenarClientesPorAtraso(lista, "asc").map((c) => c.id)).toEqual(["c", "a", "b"]);
  });
});

describe("CSV — neutralização de fórmula e formato", () => {
  it.each([
    ["=HYPERLINK(\"x\")", "'=HYPERLINK(\"x\")"],
    ["+1", "'+1"],
    ["-1", "'-1"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tabc", "'\tabc"],
    ["\rabc", "'\rabc"],
    ["Prefeitura de Jaguapitã", "Prefeitura de Jaguapitã"],
    ["a=b", "a=b"]
  ])("%j → %j", (entrada, esperado) => {
    expect(neutralizarFormula(entrada)).toBe(esperado);
  });

  it("BOM UTF-8, separador ;, CRLF, vírgula decimal, nome malicioso neutralizado e aspas escapadas, sem contato", () => {
    const csv = gerarCsvClientes([
      {
        id: "x", nome: '=cmd|"/C calc"!A0', uf: "PR", plano: "medio_porte", planoRotulo: "Médio Porte", statusContrato: "ativo", terminoAvisoPrevio: null, implantacaoACobrarCentavos: null,
        valorMensalCentavos: 450050, notasEmAberto: 2, valorEmAbertoCentavos: 5, maiorAtrasoDias: 61, situacao: "inadimplente"
      }
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const linhas = csv.slice(1).split("\r\n");
    expect(linhas[0]).toBe("Cliente;UF;Plano;Valor mensal (R$);Notas em aberto;Valor em aberto (R$);Maior atraso (dias);Situação");
    // Plano sai pelo RÓTULO (rodada 11-A), não pelo id.
    expect(linhas[1]).toBe(`"'=cmd|""/C calc""!A0";PR;Médio Porte;4500,50;2;0,05;61;Inadimplente`);
    expect(csv).not.toMatch(/@|e-mail|telefone/i);
  });
});

describe("implantação (rodada 11-A) — cobrança única, fora do MRR", () => {
  const porte = (extra: Partial<LinhaClientePainel> = {}) =>
    cliente({ id: "p1", nome: "Prefeitura Porte", plano: "medio_porte", valor_mensal: "15000.00", taxa_implantacao: "20000.00", tem_implantacao_ativa: false, ...extra });

  it("cliente ativo com taxa e sem nota de implantação → a cobrar; MRR só com a mensalidade", () => {
    const p = montarPainelFinanceiro({ clientes: [porte()], notas: [], hoje: HOJE });
    expect(p.kpis.mrr.valorCentavos).toBe(1500000);
    expect(p.kpis.implantacao).toEqual({ aCobrar: { clientes: 1, centavos: 2000000 }, aReceberCentavos: 0, recebidaCentavos: 0 });
    expect(p.clientes[0]).toMatchObject({ planoRotulo: "Médio Porte", implantacaoACobrarCentavos: 2000000 });
  });

  it.each([
    ["já tem nota de implantação ativa", { tem_implantacao_ativa: true }],
    ["contrato suspenso", { status_contrato: "suspenso" }],
    ["sem taxa combinada", { taxa_implantacao: null }]
  ])("%s → nada a cobrar", (_d, extra) => {
    const p = montarPainelFinanceiro({ clientes: [porte(extra as Partial<LinhaClientePainel>)], notas: [], hoje: HOJE });
    expect(p.kpis.implantacao.aCobrar).toEqual({ clientes: 0, centavos: 0 });
    expect(p.clientes[0].implantacaoACobrarCentavos).toBeNull();
  });

  it("nota de implantação: entra em a receber/recebido/inadimplência, NUNCA no MRR; quebra própria no quadro de implantação", () => {
    const p = montarPainelFinanceiro({
      clientes: [porte({ tem_implantacao_ativa: true })],
      notas: [
        // implantação vencida (limite 2026-10-19 → 10 dias)
        nota({ cliente_id: "p1", tipo: "implantacao", valor: "20000.00", status: "atestada", data_emissao: "2026-09-10", data_atesto: "2026-09-19", data_limite_pagamento: "2026-10-19", competencia: "2026-09-01" }),
        // mensalidade paga em outubro
        nota({ cliente_id: "p1", tipo: "mensalidade", valor: "15000.00", status: "paga", data_emissao: "2026-09-01", data_atesto: "2026-09-02", data_limite_pagamento: "2026-10-02", data_pagamento: "2026-10-01", competencia: "2026-09-01" })
      ],
      hoje: HOJE
    });
    expect(p.kpis.mrr.valorCentavos).toBe(1500000);
    expect(p.kpis.aReceber?.totalCentavos).toBe(2000000);
    expect(p.kpis.aReceber?.vencidasCentavos).toBe(2000000);
    expect(p.kpis.recebidoMesCentavos).toBe(1500000);
    expect(p.kpis.inadimplencia).toEqual({ percentual: 57.1, vencidoCentavos: 2000000, faturadoCentavos: 3500000 });
    expect(p.kpis.implantacao).toEqual({ aCobrar: { clientes: 0, centavos: 0 }, aReceberCentavos: 2000000, recebidaCentavos: 0 });
  });

  it("implantação paga na janela → recebida", () => {
    const p = montarPainelFinanceiro({
      clientes: [porte({ tem_implantacao_ativa: true })],
      notas: [nota({ cliente_id: "p1", tipo: "implantacao", valor: "20000.00", status: "paga", data_emissao: "2026-08-01", data_atesto: "2026-08-02", data_limite_pagamento: "2026-09-01", data_pagamento: "2026-08-20", competencia: "2026-08-01" })],
      hoje: HOJE
    });
    expect(p.kpis.implantacao.recebidaCentavos).toBe(2000000);
  });
});

