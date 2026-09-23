import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function ResendMock() {
    return { emails: { send: sendMock } };
  })
}));

import { notificarClientePrefeitura } from "./notificacaoCliente";

const ENV_ORIGINAL = {
  resendApiKey: process.env.RESEND_API_KEY,
  destino: process.env.COBRANCA_EMAIL_DESTINO,
  remetente: process.env.ALERTA_EMAIL_REMETENTE
};

function restaurarEnv(chave: string, valorOriginal: string | undefined) {
  if (valorOriginal === undefined) delete process.env[chave];
  else process.env[chave] = valorOriginal;
}

function limparEnv() {
  delete process.env.RESEND_API_KEY;
  delete process.env.COBRANCA_EMAIL_DESTINO;
  delete process.env.ALERTA_EMAIL_REMETENTE;
}

function configurarEnvCompleto() {
  process.env.RESEND_API_KEY = "re_teste_fake";
  process.env.COBRANCA_EMAIL_DESTINO = "financeiro@nexaigen.com.br";
  process.env.ALERTA_EMAIL_REMETENTE = "alertas@nexaigen.com.br";
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: "email-fake-id" }, error: null });
});

afterEach(() => {
  restaurarEnv("RESEND_API_KEY", ENV_ORIGINAL.resendApiKey);
  restaurarEnv("COBRANCA_EMAIL_DESTINO", ENV_ORIGINAL.destino);
  restaurarEnv("ALERTA_EMAIL_REMETENTE", ENV_ORIGINAL.remetente);
  vi.clearAllMocks();
});

const BASE = {
  clienteNome: "Prefeitura Municipal de Jaguapitã",
  contatoEmail: "financeiro@jaguapita.pr.gov.br",
  numeroNf: "NF-1234",
  valor: 4500,
  dataVencimento: "2026-08-15"
};

// Frases que NUNCA podem aparecer em nenhum estágio — o requisito mais
// importante deste módulo (tom institucional, nunca ameaça/afirmação
// jurídica). Verificado nos 4 estágios, não só no mais avançado.
const TERMOS_PROIBIDOS = ["protestar", "protesto", "acionar", "medidas legais", "medida legal", "jurídic", "cartório", "negativa"];

describe("notificarClientePrefeitura — RESEND_API_KEY ausente", () => {
  it("não chama o client do Resend, nunca lança, devolve false", async () => {
    limparEnv();

    await expect(notificarClientePrefeitura({ ...BASE, tipo: "vencido" })).resolves.toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("notificarClientePrefeitura — contatoEmail ausente", () => {
  it("não chama o client do Resend, nunca lança, devolve false (mesmo com RESEND_API_KEY presente)", async () => {
    configurarEnvCompleto();

    await expect(notificarClientePrefeitura({ ...BASE, tipo: "vencido", contatoEmail: null })).resolves.toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe.each([
  ["sem_atesto_prolongado", "aguardando atesto"],
  ["proximo_vencimento", "Lembrete: vencimento próximo"],
  ["vencido", "Nota fiscal vencida"],
  ["atraso_60_dias", "em atraso há mais de 60 dias"]
] as const)("notificarClientePrefeitura — estágio %s", (tipo, trechoAssuntoEsperado) => {
  it(`envia pro contato do cliente, BCC pro time interno, assunto contém "${trechoAssuntoEsperado}", nunca contém termo de cobrança/ameaça`, async () => {
    configurarEnvCompleto();

    const enviado = await notificarClientePrefeitura({ ...BASE, tipo });

    expect(enviado).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];

    expect(payload.from).toBe("alertas@nexaigen.com.br");
    expect(payload.to).toBe(BASE.contatoEmail);
    expect(payload.bcc).toBe("financeiro@nexaigen.com.br");
    expect(payload.cc).toBeUndefined();
    expect(payload.subject).toContain(trechoAssuntoEsperado);
    expect(payload.html).toContain(BASE.numeroNf);
    expect(payload.html).toContain("4500.00");

    const textoCompleto = `${payload.subject} ${payload.html}`.toLowerCase();
    for (const termo of TERMOS_PROIBIDOS) {
      expect(textoCompleto).not.toContain(termo);
    }
  });
});

describe("notificarClientePrefeitura — datas nos estágios que dependem de vencimento", () => {
  it("proximo_vencimento — inclui a data de vencimento formatada dd/mm/aaaa", async () => {
    configurarEnvCompleto();

    await notificarClientePrefeitura({ ...BASE, tipo: "proximo_vencimento" });

    const payload = sendMock.mock.calls[0][0];
    expect(payload.html).toContain("15/08/2026");
  });

  it("vencido — inclui a data de vencimento formatada dd/mm/aaaa", async () => {
    configurarEnvCompleto();

    await notificarClientePrefeitura({ ...BASE, tipo: "vencido" });

    const payload = sendMock.mock.calls[0][0];
    expect(payload.html).toContain("15/08/2026");
  });

  it("atraso_60_dias — inclui a data de vencimento formatada dd/mm/aaaa", async () => {
    configurarEnvCompleto();

    await notificarClientePrefeitura({ ...BASE, tipo: "atraso_60_dias" });

    const payload = sendMock.mock.calls[0][0];
    expect(payload.html).toContain("15/08/2026");
  });
});

describe("notificarClientePrefeitura — BCC ausente", () => {
  it("sem COBRANCA_EMAIL_DESTINO configurada — ainda envia pro cliente, mas sem bcc (nunca bloqueia o e-mail principal)", async () => {
    process.env.RESEND_API_KEY = "re_teste_fake";
    process.env.ALERTA_EMAIL_REMETENTE = "alertas@nexaigen.com.br";
    delete process.env.COBRANCA_EMAIL_DESTINO;

    const enviado = await notificarClientePrefeitura({ ...BASE, tipo: "vencido" });

    expect(enviado).toBe(true);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.bcc).toBeUndefined();
  });
});

describe("notificarClientePrefeitura — falhas de envio", () => {
  it("erro devolvido pela API do Resend (error != null) — devolve false, nunca lança", async () => {
    configurarEnvCompleto();
    sendMock.mockResolvedValue({ data: null, error: { message: "chave inválida", statusCode: 401, name: "invalid_api_key" } });

    await expect(notificarClientePrefeitura({ ...BASE, tipo: "vencido" })).resolves.toBe(false);
  });

  it("exceção lançada pelo client (rede) — devolve false, nunca lança", async () => {
    configurarEnvCompleto();
    sendMock.mockRejectedValue(new Error("erro de rede simulado"));

    await expect(notificarClientePrefeitura({ ...BASE, tipo: "vencido" })).resolves.toBe(false);
  });

  it("timeout — aborta depois de 5s e devolve false, nunca lança", async () => {
    configurarEnvCompleto();
    vi.useFakeTimers();
    sendMock.mockImplementation(() => new Promise(() => {}));

    const promessa = notificarClientePrefeitura({ ...BASE, tipo: "vencido" });
    await vi.advanceTimersByTimeAsync(5000);

    await expect(promessa).resolves.toBe(false);
    vi.useRealTimers();
  });

  it("nunca loga a RESEND_API_KEY", async () => {
    configurarEnvCompleto();
    process.env.RESEND_API_KEY = "re_chave-secreta-nao-pode-vazar";
    sendMock.mockRejectedValue(new Error("erro de rede simulado"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await notificarClientePrefeitura({ ...BASE, tipo: "vencido" });

    for (const chamada of warnSpy.mock.calls) {
      for (const argumento of chamada) {
        expect(String(argumento)).not.toContain("re_chave-secreta-nao-pode-vazar");
      }
    }
    warnSpy.mockRestore();
  });
});
