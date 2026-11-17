// lib/relatorioContratos.ts — limites de mês (com o "mês atual" em
// America/Sao_Paulo, incluindo virada de mês e de ano), validação do mês,
// variação sem divisão por zero, encerrados/aviso prévio pela trilha de
// eventos, saldo líquido, série de 12 meses e a mesma base de MRR do Painel.

import { describe, expect, it } from "vitest";
import { calcularMrr, hojeEmSaoPaulo } from "./painelFinanceiro";
import {
  emAvisoPrevioNaData,
  encerradosNoMes,
  limitesDoMes,
  mesAnterior,
  montarRelatorioContratos,
  origemDoContrato,
  rotuloMes,
  validarMes,
  variacao,
  type LinhaClienteRelatorio,
  type LinhaEventoContrato
} from "./relatorioContratos";

describe("mês atual em America/Sao_Paulo", () => {
  it("virada de mês: 01/12 02:59 UTC ainda é 30/11 em Brasília", () => {
    expect(hojeEmSaoPaulo(new Date("2026-12-01T02:59:00Z")).slice(0, 7)).toBe("2026-11");
    expect(hojeEmSaoPaulo(new Date("2026-12-01T03:00:00Z")).slice(0, 7)).toBe("2026-12");
  });
  it("virada de ano: 01/01/2027 01:00 UTC ainda é dezembro de 2026", () => {
    expect(hojeEmSaoPaulo(new Date("2027-01-01T01:00:00Z")).slice(0, 7)).toBe("2026-12");
  });
});

describe("limites e navegação de mês", () => {
  it.each([
    ["2026-01", "2026-01-01", "2026-01-31"],
    ["2026-02", "2026-02-01", "2026-02-28"],
    ["2028-02", "2028-02-01", "2028-02-29"],
    ["2026-04", "2026-04-01", "2026-04-30"],
    ["2026-12", "2026-12-01", "2026-12-31"]
  ])("%s → %s a %s", (mes, inicio, fim) => {
    expect(limitesDoMes(mes)).toEqual({ inicio, fim });
  });
  it("mês anterior atravessa o ano; rótulo mm/aaaa", () => {
    expect(mesAnterior("2026-01")).toBe("2025-12");
    expect(mesAnterior("2026-11")).toBe("2026-10");
    expect(rotuloMes("2026-03")).toBe("03/2026");
  });
  it("validarMes: formato, mês 13, antes de 2000 e futuro", () => {
    expect(validarMes("2026-11", "2026-11")).toBeNull();
    expect(validarMes("2026-13", "2026-11")).toBe("Mês inválido — use aaaa-mm.");
    expect(validarMes("2026-1", "2026-11")).toBe("Mês inválido — use aaaa-mm.");
    expect(validarMes("1999-12", "2026-11")).toBe("Mês anterior a 2000 — confira o ano.");
    expect(validarMes("2026-12", "2026-11")).toBe("Esse mês ainda não chegou.");
  });
});

describe("variação", () => {
  it("absoluta e percentual com 1 casa; mês anterior zero → percentual null (nunca divide por zero)", () => {
    expect(variacao(3, 2)).toEqual({ absoluta: 1, percentual: 50 });
    expect(variacao(1, 3)).toEqual({ absoluta: -2, percentual: -66.7 });
    expect(variacao(2, 0)).toEqual({ absoluta: 2, percentual: null });
    expect(variacao(0, 0)).toEqual({ absoluta: 0, percentual: null });
  });
});

let seq = 0;
function cliente(extra: Partial<LinhaClienteRelatorio> = {}): LinhaClienteRelatorio {
  seq += 1;
  return {
    id: `c${seq}`, nome: `Prefeitura ${seq}`, uf: "PR", plano: "dispensa", valor_mensal: "1000.00", status_contrato: "ativo",
    taxa_implantacao: null, tem_implantacao_ativa: false, cancelamento_termino_em: null, data_inicio_contrato: "2026-11-05", municipio_id_externo: null, ...extra
  };
}
const evento = (cliente_id: string, tipo: LinhaEventoContrato["tipo"], data_evento: string, criado_em = `${data_evento}T12:00:00.000Z`): LinhaEventoContrato => ({ cliente_id, tipo, data_evento, criado_em });

describe("encerrados e aviso prévio pela trilha de eventos", () => {
  it("encerrado no mês = evento contrato_encerrado com data no mês (cliente contado uma vez)", () => {
    const ev = [evento("a", "contrato_encerrado", "2026-11-03"), evento("b", "contrato_encerrado", "2026-10-31"), evento("a", "contrato_encerrado", "2026-11-20")];
    expect([...encerradosNoMes(ev, "2026-11")]).toEqual(["a"]);
  });

  it("em aviso na data: último evento é o registro e o término (pedido + 30) não passou; retratado/encerrado/vencido não", () => {
    const ev = [
      evento("aviso", "cancelamento_registrado", "2026-11-10"),
      evento("retratado", "cancelamento_registrado", "2026-11-01"),
      evento("retratado", "cancelamento_retratado", "2026-11-15"),
      evento("vencido", "cancelamento_registrado", "2026-10-01"), // término 31/10
      evento("depois", "cancelamento_registrado", "2026-12-02"),
      // mesmo dia: registrado e encerrado na mesma transação (ofício antigo) — a ordem é pelo criado_em
      evento("na-hora", "cancelamento_registrado", "2026-11-01", "2026-11-20T10:00:00.000Z"),
      evento("na-hora", "contrato_encerrado", "2026-11-01", "2026-11-20T10:00:00.001Z")
    ];
    expect([...emAvisoPrevioNaData(ev, "2026-11-30")].sort()).toEqual(["aviso"]);
    // No dia do término ainda está em aviso (31/10 = 01/10 + 30).
    expect([...emAvisoPrevioNaData(ev, "2026-10-31")].sort()).toEqual(["vencido"]);
    // Antes da retratação, "retratado" estava em aviso.
    expect([...emAvisoPrevioNaData(ev, "2026-11-14")].sort()).toEqual(["aviso", "retratado"]);
  });
});

describe("montarRelatorioContratos", () => {
  const HOJE = "2026-11-17";

  it("novos do mês, anterior, variação, implantação, encerrados, aviso, saldo líquido, tabela ordenada e origem", () => {
    const novo1 = cliente({ nome: "Beta", valor_mensal: "8500.00", plano: "pequeno_porte", taxa_implantacao: "15000.00", data_inicio_contrato: "2026-11-10", municipio_id_externo: "m-1" });
    const novo2 = cliente({ nome: "Alfa", valor_mensal: "5457.00", data_inicio_contrato: "2026-11-10" });
    const novo3 = cliente({ nome: "Gama", valor_mensal: "1500.50", plano: "medio_porte", taxa_implantacao: "20000.00", tem_implantacao_ativa: true, data_inicio_contrato: "2026-11-01" });
    const outubro = cliente({ valor_mensal: "3000.00", data_inicio_contrato: "2026-10-31" });
    const saiu = cliente({ valor_mensal: "999.99", data_inicio_contrato: "2025-01-01", status_contrato: "encerrado" });
    const emAviso = cliente({ valor_mensal: "700.00", data_inicio_contrato: "2025-06-01", status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-12-05" });
    const r = montarRelatorioContratos({
      clientes: [novo1, novo2, novo3, outubro, saiu, emAviso],
      eventos: [evento(saiu.id, "contrato_encerrado", "2026-11-02"), evento(emAviso.id, "cancelamento_registrado", "2026-11-05")],
      mes: "2026-11",
      hoje: HOJE
    });

    expect(r.semContratos).toBe(false);
    expect(r.dataReferencia).toBe(HOJE); // mês atual: corte em hoje
    expect(r.novos).toEqual({ quantidade: 3, mrrCentavos: 1545750, implantacaoACobrarCentavos: 1500000 }); // Gama já tem nota de implantação
    expect(r.anterior).toEqual({ quantidade: 1, mrrCentavos: 300000 });
    expect(r.variacao).toEqual({ quantidade: { absoluta: 2, percentual: 200 }, mrr: { absoluta: 1245750, percentual: 415.3 } });
    expect(r.encerrados).toEqual({ quantidade: 1, mrrCentavos: 99999 });
    expect(r.emAvisoPrevio).toEqual({ quantidade: 1, mrrCentavos: 70000 });
    expect(r.saldoLiquido).toEqual({ quantidade: 2, mrrCentavos: 1445751 });
    expect(r.contratos.map((c) => [c.nome, c.dataInicio, c.origem, c.planoRotulo])).toEqual([
      ["Gama", "2026-11-01", "painel", "Médio Porte"],
      ["Alfa", "2026-11-10", "painel", "Dispensa"],
      ["Beta", "2026-11-10", "educa", "Pequeno Porte"]
    ]);
    expect(r.contratos[2]).toMatchObject({ valorMensalCentavos: 850000, taxaImplantacaoCentavos: 1500000, statusContrato: "ativo" });
    // MRR da carteira: a MESMA função do Painel.
    expect(r.mrrCarteiraHojeCentavos).toBe(calcularMrr([novo1, novo2, novo3, outubro, saiu, emAviso], HOJE).valorCentavos);
  });

  it("mês passado: corte do aviso prévio no fim do mês; série de 12 meses com acumulado", () => {
    const c1 = cliente({ valor_mensal: "100.00", data_inicio_contrato: "2025-12-15" });
    const c2 = cliente({ valor_mensal: "200.00", data_inicio_contrato: "2026-02-01" });
    const c3 = cliente({ valor_mensal: "50.00", data_inicio_contrato: "2026-02-28" });
    const antigo = cliente({ valor_mensal: "9.00", data_inicio_contrato: "2025-02-28" }); // fora da janela
    const r = montarRelatorioContratos({ clientes: [c1, c2, c3, antigo], eventos: [evento(c1.id, "cancelamento_registrado", "2026-02-20")], mes: "2026-02", hoje: HOJE });

    expect(r.dataReferencia).toBe("2026-02-28");
    expect(r.emAvisoPrevio.quantidade).toBe(1);
    expect(r.serie).toHaveLength(12);
    expect(r.serie[0].mes).toBe("2025-03");
    expect(r.serie.map((p) => [p.mes, p.novos, p.mrrNovoCentavos, p.mrrNovoAcumuladoCentavos]).filter(([, n]) => n !== 0)).toEqual([
      ["2025-12", 1, 10000, 10000],
      ["2026-02", 2, 25000, 35000]
    ]);
    expect(r.serie.at(-1)!.mrrNovoAcumuladoCentavos).toBe(35000);
  });

  it("mês sem contrato novo → semContratos (a tela diz isso; nunca zeros fingindo dado); variação sem base → percentual null", () => {
    const r = montarRelatorioContratos({ clientes: [cliente({ data_inicio_contrato: "2026-09-10" })], eventos: [], mes: "2026-10", hoje: HOJE });
    expect(r.semContratos).toBe(true);
    expect(r.contratos).toEqual([]);
    expect(r.variacao.quantidade).toEqual({ absoluta: -1, percentual: -100 });
    const vazio = montarRelatorioContratos({ clientes: [], eventos: [], mes: "2026-10", hoje: HOJE });
    expect(vazio.variacao.quantidade).toEqual({ absoluta: 0, percentual: null });
    expect(vazio.mrrCarteiraHojeCentavos).toBeNull();
  });

  it("origem: com municipio_id_externo = integração Educa, senão cadastro manual", () => {
    expect(origemDoContrato({ municipio_id_externo: "x" })).toBe("educa");
    expect(origemDoContrato({ municipio_id_externo: null })).toBe("painel");
  });
});
