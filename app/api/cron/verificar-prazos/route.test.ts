// Testa especificamente a regra "e-mail ao cliente só na transição de
// estado, nunca todo dia enquanto o estado persistir" (decisão de
// produto da Luana, ver lib/notificacaoCliente.ts) — o caso de borda
// pedido explicitamente: o job rodando duas vezes seguidas (mesmo
// "dia") não pode duplicar o envio. `query`/notificarTimeDeCobranca/
// notificarClientePrefeitura são todos mockados — este teste não toca
// banco nem Resend de verdade, só verifica a ORQUESTRAÇÃO da rota.
//
// RODADA DE MIGRAÇÃO DE INFRAESTRUTURA: mocka @/lib/db (`query`) em vez
// de @/lib/supabase/server (`supabaseAdmin`) — a fake abaixo distingue a
// consulta pelo TEXTO do SQL (não mais por nome de tabela via
// `.from(tabela)`, que não existe mais nesta API), mas cobre exatamente
// os mesmos 4 cenários de antes, sem nenhum caso removido.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, notificarTimeMock, notificarClienteMock, alertarErroSistemaMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  notificarTimeMock: vi.fn(),
  notificarClienteMock: vi.fn(),
  alertarErroSistemaMock: vi.fn()
}));

vi.mock("@/lib/db", () => ({ query: queryMock }));
vi.mock("@/lib/notificacao-interna", () => ({ notificarTimeDeCobranca: notificarTimeMock }));
vi.mock("@/lib/notificacaoCliente", () => ({ notificarClientePrefeitura: notificarClienteMock }));
// Rodada de alerta de falha de sistema: route.ts agora chama
// alertarErroSistema quando CRON_SECRET está ausente — mockado aqui pra
// não precisar de Postgres real neste teste puro.
vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: alertarErroSistemaMock }));

import { NextRequest } from "next/server";
import * as rota from "./route";
import { POST } from "./route";

const ENV_ORIGINAL = process.env.CRON_SECRET;
const SEGREDO = "segredo-de-teste-para-o-cron";

function requisicao(): NextRequest {
  return new NextRequest("http://localhost:3001/api/cron/verificar-prazos", {
    method: "POST",
    headers: { Authorization: `Bearer ${SEGREDO}` }
  });
}

// Datas relativas a "agora" pra cair no estágio "vencido" (atesto há 40
// dias -> data_limite_pagamento = atesto+30 -> ~10 dias de atraso, abaixo
// do limiar de 60 dias de lib/prazos.ts).
function isoHaDias(dias: number): string {
  const data = new Date();
  data.setDate(data.getDate() - dias);
  return data.toISOString().slice(0, 10);
}

const DATA_ATESTO = isoHaDias(40);
const DATA_LIMITE = isoHaDias(10);

const NOTA_VENCIDA = {
  id: "nota-1",
  cliente_id: "cliente-1",
  numero_nf: "NF-9999",
  valor: "3200.00", // numeric vem como string do driver "pg" (e já vinha como algo que o cron converte com Number())
  data_emissao: isoHaDias(70),
  data_atesto: DATA_ATESTO,
  data_limite_pagamento: DATA_LIMITE,
  status: "atestada",
  cliente: { nome: "Prefeitura Municipal de Exemplo", contato_email: "financeiro@exemplo.pr.gov.br" }
};

// Distingue a consulta pelo texto do SQL — mesmo espírito do builder fake
// por tabela de antes, só que a "tabela" agora é reconhecida por um
// trecho característico da própria query.
function criarQueryFake(opts: { notas: (typeof NOTA_VENCIDA)[]; alertaResultado: { id: string } | null }) {
  return vi.fn((sql: string) => {
    if (sql.includes("from nota_fiscal nf")) return Promise.resolve(opts.notas);
    if (sql.includes("update nota_fiscal set status")) return Promise.resolve([]);
    if (sql.includes("insert into alerta_cobranca")) return Promise.resolve(opts.alertaResultado ? [opts.alertaResultado] : []);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SEGREDO;
  queryMock.mockReset();
  notificarTimeMock.mockReset().mockResolvedValue(true);
  notificarClienteMock.mockReset().mockResolvedValue(true);
  alertarErroSistemaMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  if (ENV_ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ENV_ORIGINAL;
});

describe("POST /api/cron/verificar-prazos — e-mail ao cliente só na transição de estado", () => {
  it("primeira execução — insert em alerta_cobranca traz linha nova no RETURNING (transição) — dispara e-mail ao cliente", async () => {
    queryMock.mockImplementation(criarQueryFake({ notas: [NOTA_VENCIDA], alertaResultado: { id: "alerta-1" } }));

    const res = await POST(requisicao());
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.alertasCriados).toBe(1);

    expect(notificarClienteMock).toHaveBeenCalledTimes(1);
    const dados = notificarClienteMock.mock.calls[0][0];
    expect(dados.tipo).toBe("vencido");
    expect(dados.clienteNome).toBe("Prefeitura Municipal de Exemplo");
    expect(dados.contatoEmail).toBe("financeiro@exemplo.pr.gov.br");
    expect(dados.numeroNf).toBe("NF-9999");
    expect(dados.valor).toBe(3200);
    expect(dados.dataVencimento).toBe(DATA_LIMITE);

    // "vencido" nunca aciona o alerta interno de cobrança (só
    // atraso_60_dias aciona) — o time só vê este e-mail via BCC, que é
    // responsabilidade de lib/notificacaoCliente.ts, não desta rota.
    expect(notificarTimeMock).not.toHaveBeenCalled();
  });

  it("segunda execução (mesmo estágio, job rodando de novo) — on conflict do nothing não devolve linha, NÃO dispara e-mail de novo", async () => {
    // Simula o que o RETURNING devolve quando o insert bate no índice
    // único parcial uq_alerta_ativo e é ignorado (`on conflict ... do
    // nothing`): nenhuma linha no array — mesmo efeito de
    // `ignoreDuplicates: true` + `.maybeSingle() === null` do Supabase
    // antes da migração de infraestrutura.
    queryMock.mockImplementation(criarQueryFake({ notas: [NOTA_VENCIDA], alertaResultado: null }));

    const res = await POST(requisicao());
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.alertasCriados).toBe(0);

    expect(notificarClienteMock).not.toHaveBeenCalled();
    expect(notificarTimeMock).not.toHaveBeenCalled();
  });

  it("duas execuções em sequência, primeira cria e a segunda não duplica — cenário completo do caso de borda pedido", async () => {
    queryMock.mockImplementation(criarQueryFake({ notas: [NOTA_VENCIDA], alertaResultado: { id: "alerta-1" } }));
    await POST(requisicao());
    expect(notificarClienteMock).toHaveBeenCalledTimes(1);

    queryMock.mockImplementation(criarQueryFake({ notas: [NOTA_VENCIDA], alertaResultado: null }));
    await POST(requisicao());
    expect(notificarClienteMock).toHaveBeenCalledTimes(1); // continua 1, não foi pra 2
  });

  it("alerta atraso_60_dias — dispara tanto o alerta interno de cobrança quanto o e-mail ao cliente", async () => {
    const notaCritica = {
      ...NOTA_VENCIDA,
      id: "nota-2",
      data_atesto: isoHaDias(95), // limite = atesto+30 = 65 dias atrás -> 65 dias de atraso, >= 60
      data_limite_pagamento: isoHaDias(65)
    };
    queryMock.mockImplementation(criarQueryFake({ notas: [notaCritica], alertaResultado: { id: "alerta-2" } }));

    await POST(requisicao());

    expect(notificarTimeMock).toHaveBeenCalledTimes(1);
    expect(notificarTimeMock.mock.calls[0][0].tipo).toBe("atraso_60_dias");
    expect(notificarClienteMock).toHaveBeenCalledTimes(1);
    expect(notificarClienteMock.mock.calls[0][0].tipo).toBe("atraso_60_dias");
  });
});

describe("POST /api/cron/verificar-prazos — CRON_SECRET ausente (rodada de alerta de falha de sistema)", () => {
  it("devolve 401 e alerta falha de sistema (categoria job_verificar_prazos), nunca toca o banco", async () => {
    delete process.env.CRON_SECRET;

    const res = await POST(requisicao());

    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
    expect(alertarErroSistemaMock).toHaveBeenCalledWith("job_verificar_prazos", expect.any(String));
  });
});

describe("POST /api/cron/verificar-prazos — autenticação e resumo (rodada 07)", () => {
  const notaCritica = () => ({ ...NOTA_VENCIDA, id: "nota-3", data_atesto: isoHaDias(95), data_limite_pagamento: isoHaDias(65) });

  it("resumo completo: notas avaliadas, alertas criados, e-mails enviados e limpeza do rate limit", async () => {
    queryMock.mockImplementation(criarQueryFake({ notas: [notaCritica()], alertaResultado: { id: "alerta-3" } }));

    const res = await POST(requisicao());

    expect(await res.json()).toEqual({
      notasAvaliadas: 1,
      statusAtualizados: 1,
      alertasCriados: 1,
      emails: { enviados: 2, falhos: 0, semDestinatario: 0 }, // interno (60 dias) + cliente
      contadoresRateLimitRemovidos: 0
    });
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("delete from rate_limit_contador"), [], undefined);
  });

  it("e-mail que não sai conta como falho; cliente sem contato_email conta como semDestinatario (não é falha)", async () => {
    notificarTimeMock.mockResolvedValue(false);
    const semContato = { ...notaCritica(), id: "nota-4", cliente: { nome: "Prefeitura Sem Contato", contato_email: null } };
    queryMock.mockImplementation(criarQueryFake({ notas: [semContato as unknown as typeof NOTA_VENCIDA], alertaResultado: { id: "alerta-4" } }));
    notificarClienteMock.mockResolvedValue(false);

    const corpo = await (await POST(requisicao())).json();

    expect(corpo.emails).toEqual({ enviados: 0, falhos: 1, semDestinatario: 1 });
  });

  it.each([
    ["segredo errado", "Bearer outro-segredo"],
    ["comprimento muito diferente (não lança)", `Bearer ${"x".repeat(5000)}`],
    ["sem o prefixo Bearer", SEGREDO]
  ])("%s — 401, nunca toca o banco", async (_d, header) => {
    const res = await POST(new NextRequest("http://localhost:3001/api/cron/verificar-prazos", { method: "POST", headers: { Authorization: header } }));
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("não existe mais handler GET (o cron da Vercel foi removido; rota que grava em lote só aceita POST)", () => {
    expect("GET" in rota).toBe(false);
  });
});
