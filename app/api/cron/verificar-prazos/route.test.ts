// Testa especificamente a regra "e-mail ao cliente só na transição de
// estado, nunca todo dia enquanto o estado persistir" (decisão de
// produto da Luana, ver lib/notificacaoCliente.ts) — o caso de borda
// pedido explicitamente: o job rodando duas vezes seguidas (mesmo
// "dia") não pode duplicar o envio. supabaseAdmin/notificarTimeDeCobranca/
// notificarClientePrefeitura são todos mockados — este teste não toca
// banco nem Resend de verdade, só verifica a ORQUESTRAÇÃO da rota.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseAdminMock, notificarTimeMock, notificarClienteMock } = vi.hoisted(() => ({
  supabaseAdminMock: vi.fn(),
  notificarTimeMock: vi.fn(),
  notificarClienteMock: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: supabaseAdminMock }));
vi.mock("@/lib/notificacao-interna", () => ({ notificarTimeDeCobranca: notificarTimeMock }));
vi.mock("@/lib/notificacaoCliente", () => ({ notificarClientePrefeitura: notificarClienteMock }));

import { NextRequest } from "next/server";
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
  valor: 3200,
  data_emissao: isoHaDias(70),
  data_atesto: DATA_ATESTO,
  data_limite_pagamento: DATA_LIMITE,
  status: "atestada",
  cliente: { nome: "Prefeitura Municipal de Exemplo", contato_email: "financeiro@exemplo.pr.gov.br" }
};

function criarSupabaseFake(opts: { notas: any[]; alertaResultado: { id: string } | null }) {
  const alertaBuilder: any = {
    select: () => alertaBuilder,
    upsert: () => alertaBuilder,
    maybeSingle: () => Promise.resolve({ data: opts.alertaResultado, error: null })
  };
  const notaBuilder: any = {
    select: () => notaBuilder,
    not: () => Promise.resolve({ data: opts.notas, error: null }),
    update: () => notaBuilder,
    eq: () => Promise.resolve({ error: null })
  };
  return {
    from: (tabela: string) => (tabela === "alerta_cobranca" ? alertaBuilder : notaBuilder)
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = SEGREDO;
  supabaseAdminMock.mockReset();
  notificarTimeMock.mockReset().mockResolvedValue(undefined);
  notificarClienteMock.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  if (ENV_ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ENV_ORIGINAL;
});

describe("POST /api/cron/verificar-prazos — e-mail ao cliente só na transição de estado", () => {
  it("primeira execução — alerta_cobranca upsert insere linha nova (transição) — dispara e-mail ao cliente", async () => {
    supabaseAdminMock.mockReturnValue(criarSupabaseFake({ notas: [NOTA_VENCIDA], alertaResultado: { id: "alerta-1" } }));

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

  it("segunda execução (mesmo estágio, job rodando de novo) — upsert ignora duplicata (ignoreDuplicates), NÃO dispara e-mail de novo", async () => {
    // Simula o que o Supabase real devolve quando o upsert bate no
    // índice único parcial uq_alerta_ativo e ignora silenciosamente: a
    // linha já existe, nada novo é inserido, .maybeSingle() não retorna
    // a linha ignorada.
    supabaseAdminMock.mockReturnValue(criarSupabaseFake({ notas: [NOTA_VENCIDA], alertaResultado: null }));

    const res = await POST(requisicao());
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.alertasCriados).toBe(0);

    expect(notificarClienteMock).not.toHaveBeenCalled();
    expect(notificarTimeMock).not.toHaveBeenCalled();
  });

  it("duas execuções em sequência, primeira cria e a segunda não duplica — cenário completo do caso de borda pedido", async () => {
    supabaseAdminMock.mockReturnValueOnce(criarSupabaseFake({ notas: [NOTA_VENCIDA], alertaResultado: { id: "alerta-1" } }));
    await POST(requisicao());
    expect(notificarClienteMock).toHaveBeenCalledTimes(1);

    supabaseAdminMock.mockReturnValueOnce(criarSupabaseFake({ notas: [NOTA_VENCIDA], alertaResultado: null }));
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
    supabaseAdminMock.mockReturnValue(criarSupabaseFake({ notas: [notaCritica], alertaResultado: { id: "alerta-2" } }));

    await POST(requisicao());

    expect(notificarTimeMock).toHaveBeenCalledTimes(1);
    expect(notificarTimeMock.mock.calls[0][0].tipo).toBe("atraso_60_dias");
    expect(notificarClienteMock).toHaveBeenCalledTimes(1);
    expect(notificarClienteMock.mock.calls[0][0].tipo).toBe("atraso_60_dias");
  });
});
