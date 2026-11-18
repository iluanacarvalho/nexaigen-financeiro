// lib/crm.ts — transições de etapa (incluindo 'ganho' bloqueado), selos
// "parado"/"ação vencida"/pedido de lead com DATAS FIXAS (nunca o relógio
// real), taxa de avanço (com denominador zero), sugestão de preço pelo
// plano e a normalização de nome usada na duplicidade.

import { describe, expect, it } from "vitest";
import {
  MENSAGEM_GANHO_BLOQUEADO,
  acaoParaHoje,
  acaoVencida,
  calcularTaxasDeAvanco,
  clienteEncerrado,
  clientesDoMunicipio,
  dataDoEncerramento,
  diaEmSaoPaulo,
  diasSemAtividade,
  leadParado,
  podePedirLead,
  validarTransicao,
  valorSugeridoCentavos
} from "./crm";
import { nomeDeMunicipioNormalizado } from "./ibge";
import { valoresPadrao } from "./planos";

describe("transições de etapa", () => {
  it("entre abertas: avança e volta; mesma etapa → recusa", () => {
    expect(validarTransicao("novo", { acao: "mover", etapa: "proposta" })).toEqual({ ok: true, etapaNova: "proposta", tipoHistorico: "mudanca_etapa" });
    expect(validarTransicao("negociacao", { acao: "mover", etapa: "contato" })).toEqual({ ok: true, etapaNova: "contato", tipoHistorico: "mudanca_etapa" });
    expect(validarTransicao("contato", { acao: "mover", etapa: "contato" })).toEqual({ ok: false, erro: "O lead já está na etapa Contato." });
  });

  it("'ganho' SEMPRE recusado (fechamento é a rodada 16-B), de qualquer etapa", () => {
    for (const atual of ["novo", "contato", "demonstracao", "proposta", "negociacao", "perdido"]) {
      expect(validarTransicao(atual, { acao: "mover", etapa: "ganho" })).toEqual({ ok: false, erro: MENSAGEM_GANHO_BLOQUEADO });
    }
  });

  it("perder: de qualquer aberta (motivo vem do schema); 'mover' pra perdido sem motivo → recusa", () => {
    expect(validarTransicao("proposta", { acao: "perder", motivo: "preco", detalhe: null })).toEqual({ ok: true, etapaNova: "perdido", tipoHistorico: "mudanca_etapa" });
    expect(validarTransicao("proposta", { acao: "mover", etapa: "perdido" })).toMatchObject({ ok: false, erro: expect.stringMatching(/motivo/) });
  });

  it("de perdido: só reabrir (→ contato, histórico 'reabertura'); reabrir aberto → recusa; ganho não muda", () => {
    expect(validarTransicao("perdido", { acao: "reabrir" })).toEqual({ ok: true, etapaNova: "contato", tipoHistorico: "reabertura" });
    expect(validarTransicao("perdido", { acao: "mover", etapa: "novo" })).toMatchObject({ ok: false, erro: expect.stringMatching(/reabra/) });
    expect(validarTransicao("perdido", { acao: "perder", motivo: "outro", detalhe: null })).toMatchObject({ ok: false });
    expect(validarTransicao("contato", { acao: "reabrir" })).toEqual({ ok: false, erro: "Só um lead perdido pode ser reaberto." });
    expect(validarTransicao("ganho", { acao: "mover", etapa: "contato" })).toMatchObject({ ok: false, erro: expect.stringMatching(/fechado/) });
  });
});

describe("selos e datas (datas fixas)", () => {
  const HOJE = "2026-11-18";
  it("dia em São Paulo: 18/11 02:00 UTC ainda é 17/11", () => {
    expect(diaEmSaoPaulo("2026-11-18T02:00:00.000Z")).toBe("2026-11-17");
    expect(diaEmSaoPaulo("2026-11-18T03:00:00.000Z")).toBe("2026-11-18");
  });

  it("parado: MAIS de 14 dias sem atividade (14 ainda não); só lead aberto", () => {
    expect(diasSemAtividade("2026-11-04T15:00:00.000Z", HOJE)).toBe(14);
    expect(leadParado("contato", "2026-11-04T15:00:00.000Z", HOJE)).toBe(false);
    expect(leadParado("contato", "2026-11-03T15:00:00.000Z", HOJE)).toBe(true);
    expect(leadParado("perdido", "2026-01-01T15:00:00.000Z", HOJE)).toBe(false);
  });

  it("ação vencida: antes de hoje; ação de hoje: hoje ou antes; nula nunca; fechado nunca", () => {
    expect(acaoVencida("novo", "2026-11-17", HOJE)).toBe(true);
    expect(acaoVencida("novo", "2026-11-18", HOJE)).toBe(false);
    expect(acaoParaHoje("novo", "2026-11-18", HOJE)).toBe(true);
    expect(acaoParaHoje("novo", "2026-11-19", HOJE)).toBe(false);
    expect(acaoVencida("novo", null, HOJE)).toBe(false);
    expect(acaoVencida("perdido", "2026-11-01", HOJE)).toBe(false);
  });

  it("pedir lead de colega: MAIS de 60 dias sem atividade, lead aberto", () => {
    expect(podePedirLead("proposta", "2026-09-19T15:00:00.000Z", HOJE)).toBe(false); // 60 dias
    expect(podePedirLead("proposta", "2026-09-18T15:00:00.000Z", HOJE)).toBe(true); // 61 dias
    expect(podePedirLead("perdido", "2025-01-01T15:00:00.000Z", HOJE)).toBe(false);
  });
});

describe("taxa de avanço", () => {
  it("maior etapa alcançada; pular etapa conta; perdido conta pela etapa alcançada", () => {
    const taxas = calcularTaxasDeAvanco([
      ["novo"], // parou em Novo
      ["novo", "contato"],
      ["novo", "proposta"], // pulou contato e demonstração
      ["novo", "contato", "demonstracao", "perdido"] // perdido depois de Demonstração
    ]);
    expect(taxas.map((t) => [t.de, t.para, t.entraram, t.passaram, t.percentual])).toEqual([
      ["novo", "contato", 4, 3, 75],
      ["contato", "demonstracao", 3, 2, 66.7],
      ["demonstracao", "proposta", 2, 1, 50],
      ["proposta", "negociacao", 1, 0, 0],
      ["negociacao", "ganho", 0, 0, null] // ninguém entrou: "—", nunca divisão por zero
    ]);
  });
  it("carteira vazia: todas as taxas null", () => {
    expect(calcularTaxasDeAvanco([]).every((t) => t.percentual === null && t.entraram === 0)).toBe(true);
  });
});

describe("preço sugerido e normalização de nome", () => {
  it("sugestão = mensalidade padrão do plano (mesma tabela de lib/planos.ts)", () => {
    for (const plano of ["dispensa", "pequeno_porte", "medio_porte", "grande_porte"] as const) {
      expect(valorSugeridoCentavos(plano)).toBe(valoresPadrao(plano).valorMensalCentavos);
    }
    expect(valorSugeridoCentavos("pequeno_porte")).toBe(850000);
  });
  it("duplicidade: sem acento, sem caixa, sem 'Prefeitura (Municipal) de'", () => {
    const chave = nomeDeMunicipioNormalizado("Jaguapitã");
    for (const variante of ["JAGUAPITA", "jaguapitã", "  Prefeitura Municipal de Jaguapitã ", "Município de Jaguapitã", "Prefeitura de JAGUAPITÃ"]) {
      expect(nomeDeMunicipioNormalizado(variante)).toBe(chave);
    }
    expect(nomeDeMunicipioNormalizado("São João d'Aliança")).toBe("sao joao d alianca");
    expect(nomeDeMunicipioNormalizado("Jaguaré")).not.toBe(chave);
  });
});

describe("ex-cliente (rodada 16-A1)", () => {
  const HOJE = "2026-11-18";
  const cliente = (extra: object) => ({ nome: "Prefeitura Municipal de Maringá", uf: "PR", codigo_ibge: null as string | null, status_contrato: "encerrado", cancelamento_termino_em: null as string | null, encerrado_em: null as string | null, ...extra });

  it("cliente do mesmo município: código IBGE igual, ou UF + nome normalizado", () => {
    const clientes = [cliente({}), cliente({ nome: "Maringá", uf: "SP" }), cliente({ nome: "Outra", codigo_ibge: "4115200" })];
    expect(clientesDoMunicipio(clientes, { uf: "PR", nomeBusca: "maringa", codigoIbge: null })).toEqual([clientes[0]]);
    expect(clientesDoMunicipio(clientes, { uf: "PR", nomeBusca: "nada", codigoIbge: "4115200" })).toEqual([clientes[2]]);
  });

  it("encerrado HOJE: 'encerrado', ou aviso prévio com término já passado; ativo, suspenso e aviso vigente não", () => {
    expect(clienteEncerrado(cliente({}), HOJE)).toBe(true);
    expect(clienteEncerrado(cliente({ status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-11-17" }), HOJE)).toBe(true);
    expect(clienteEncerrado(cliente({ status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-11-18" }), HOJE)).toBe(false); // encerrando
    expect(clienteEncerrado(cliente({ status_contrato: "ativo" }), HOJE)).toBe(false);
    expect(clienteEncerrado(cliente({ status_contrato: "suspenso" }), HOJE)).toBe(false);
  });

  it("data do encerramento: evento, senão término do aviso, senão null", () => {
    expect(dataDoEncerramento(cliente({ encerrado_em: "2026-03-31", cancelamento_termino_em: "2026-03-30" }))).toBe("2026-03-31");
    expect(dataDoEncerramento(cliente({ cancelamento_termino_em: "2026-03-30" }))).toBe("2026-03-30");
    expect(dataDoEncerramento(cliente({}))).toBeNull();
  });
});
