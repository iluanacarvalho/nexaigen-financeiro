// Testes unitários de lib/alertaErroSistema.ts — Resend mockado (nunca
// rede real) e @/lib/db mockado (nunca Postgres real; o comportamento
// real do debounce atômico contra um banco de verdade é coberto por
// lib/alertaErroSistema.integration.test.ts). O "debounce" aqui é
// simulado controlando o que a query mockada devolve: uma linha no
// RETURNING significa "não debounçado, pode enviar"; array vazio
// significa "já debounçado, não envia".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted (não `const` solto): vi.mock() é hoisted pro TOPO do arquivo
// pelo vitest, antes de QUALQUER import/statement top-level — referenciar
// um `const` comum dentro da factory do vi.mock lança "Cannot access
// before initialization" (TDZ), já que a factory é avaliada antes do
// `const` ser inicializado. vi.hoisted roda na mesma fase de hoisting dos
// vi.mock (precisa vir ANTES de quem o usa), disponibilizando o valor a
// tempo.
const { sendMock, queryMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  queryMock: vi.fn()
}));

// mockImplementation precisa de uma function tradicional (não arrow) — o
// código real chama `new Resend(apiKey)`, e uma arrow function não pode
// ser invocada com `new`.
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function ResendMock() {
    return { emails: { send: sendMock } };
  })
}));

vi.mock("./db", () => ({ query: queryMock }));

import { alertarErroSistema } from "./alertaErroSistema";

const ENV_ORIGINAL = {
  resendApiKey: process.env.RESEND_API_KEY,
  destino: process.env.ALERTA_SISTEMA_EMAILS_DESTINO,
  remetente: process.env.ALERTA_EMAIL_REMETENTE
};

function restaurarEnv(chave: string, valorOriginal: string | undefined) {
  if (valorOriginal === undefined) delete process.env[chave];
  else process.env[chave] = valorOriginal;
}

function limparEnv() {
  delete process.env.RESEND_API_KEY;
  delete process.env.ALERTA_SISTEMA_EMAILS_DESTINO;
  delete process.env.ALERTA_EMAIL_REMETENTE;
}

function configurarEnvCompleto() {
  process.env.RESEND_API_KEY = "re_teste_fake";
  process.env.ALERTA_SISTEMA_EMAILS_DESTINO = "luana@nexaigen.com.br,suporte@nexaigen.com.br";
  process.env.ALERTA_EMAIL_REMETENTE = "alertas@nexaigen.com.br";
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: "email-fake-id" }, error: null });
  queryMock.mockReset();
  // Default: simula "não debounçado" (o INSERT ... WHERE NOT EXISTS
  // devolveu uma linha) — testes de debounce sobrescrevem isso.
  queryMock.mockResolvedValue([{ id: "log-1" }]);
});

afterEach(() => {
  restaurarEnv("RESEND_API_KEY", ENV_ORIGINAL.resendApiKey);
  restaurarEnv("ALERTA_SISTEMA_EMAILS_DESTINO", ENV_ORIGINAL.destino);
  restaurarEnv("ALERTA_EMAIL_REMETENTE", ENV_ORIGINAL.remetente);
  vi.clearAllMocks();
});

describe("alertarErroSistema — debounce (simulado via mock de query)", () => {
  it("INSERT ... WHERE NOT EXISTS devolve uma linha (não debounçado) — envia o e-mail", async () => {
    configurarEnvCompleto();
    queryMock.mockResolvedValue([{ id: "log-1" }]);

    await alertarErroSistema("railway_bucket", "falha simulada");

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("INSERT ... WHERE NOT EXISTS não devolve linha (já debounçado nos últimos 30min) — NÃO envia o e-mail, nunca lança", async () => {
    configurarEnvCompleto();
    queryMock.mockResolvedValue([]);

    await expect(alertarErroSistema("railway_bucket", "falha simulada")).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("chama query com categoria, mensagem e janela de 30 minutos parametrizados (nunca interpolados na string)", async () => {
    configurarEnvCompleto();

    await alertarErroSistema("resend_interno", "mensagem de teste");

    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("insert into log_alerta_sistema"), [
      "resend_interno",
      "mensagem de teste",
      30
    ]);
  });
});

describe("alertarErroSistema — RESEND_API_KEY/ALERTA_SISTEMA_EMAILS_DESTINO ausentes", () => {
  it("RESEND_API_KEY ausente — registra a tentativa de debounce, mas não chama o client do Resend, nunca lança", async () => {
    limparEnv();
    process.env.ALERTA_SISTEMA_EMAILS_DESTINO = "luana@nexaigen.com.br";

    await expect(alertarErroSistema("railway_bucket", "falha")).resolves.toBeUndefined();
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("ALERTA_SISTEMA_EMAILS_DESTINO ausente — não chama o client do Resend, nunca lança (mesmo com RESEND_API_KEY presente)", async () => {
    limparEnv();
    process.env.RESEND_API_KEY = "re_teste_fake";

    await expect(alertarErroSistema("railway_bucket", "falha")).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("alertarErroSistema — múltiplos destinatários", () => {
  it("ALERTA_SISTEMA_EMAILS_DESTINO com múltiplos e-mails separados por vírgula (com espaços) — todos viram destinatários", async () => {
    configurarEnvCompleto();
    process.env.ALERTA_SISTEMA_EMAILS_DESTINO = "luana@nexaigen.com.br, suporte@nexaigen.com.br ,  outra@nexaigen.com.br";

    await alertarErroSistema("railway_bucket", "falha");

    const payload = sendMock.mock.calls[0][0];
    expect(payload.to).toEqual(["luana@nexaigen.com.br", "suporte@nexaigen.com.br", "outra@nexaigen.com.br"]);
  });

  it("um único e-mail (sem vírgula) ainda vira array com um elemento", async () => {
    configurarEnvCompleto();
    process.env.ALERTA_SISTEMA_EMAILS_DESTINO = "luana@nexaigen.com.br";

    await alertarErroSistema("railway_bucket", "falha");

    expect(sendMock.mock.calls[0][0].to).toEqual(["luana@nexaigen.com.br"]);
  });
});

describe("alertarErroSistema — assunto/corpo do e-mail", () => {
  it("assunto contém a categoria, corpo HTML contém categoria e mensagem escapados", async () => {
    configurarEnvCompleto();

    await alertarErroSistema("railway_bucket", "Falha <script>alert(1)</script> simulada");

    const payload = sendMock.mock.calls[0][0];
    expect(payload.subject).toContain("railway_bucket");
    expect(payload.html).toContain("railway_bucket");
    expect(payload.html).not.toContain("<script>alert(1)</script>");
    expect(payload.html).toContain("&lt;script&gt;");
  });
});

describe("alertarErroSistema — nunca lança exceção", () => {
  it("erro devolvido pela API do Resend (error != null) — não lança", async () => {
    configurarEnvCompleto();
    sendMock.mockResolvedValue({ data: null, error: { message: "chave inválida", statusCode: 401, name: "invalid_api_key" } });

    await expect(alertarErroSistema("railway_bucket", "falha")).resolves.toBeUndefined();
  });

  it("exceção lançada pelo client (rede/timeout) — não lança", async () => {
    configurarEnvCompleto();
    sendMock.mockRejectedValue(new Error("erro de rede simulado"));

    await expect(alertarErroSistema("railway_bucket", "falha")).resolves.toBeUndefined();
  });

  it("timeout — aborta depois de 5s e não lança", async () => {
    configurarEnvCompleto();
    vi.useFakeTimers();
    sendMock.mockImplementation(() => new Promise(() => {}));

    const promessa = alertarErroSistema("railway_bucket", "falha");
    await vi.advanceTimersByTimeAsync(5000);

    await expect(promessa).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("query() (debounce) lançando — ex.: Postgres indisponível — não lança, nunca chega a chamar o Resend", async () => {
    configurarEnvCompleto();
    queryMock.mockRejectedValue(new Error("connection refused"));

    await expect(alertarErroSistema("railway_bucket", "falha")).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("nunca loga a RESEND_API_KEY", async () => {
    configurarEnvCompleto();
    process.env.RESEND_API_KEY = "re_chave-secreta-nao-pode-vazar";
    sendMock.mockRejectedValue(new Error("erro de rede simulado"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await alertarErroSistema("railway_bucket", "falha");

    for (const chamada of errorSpy.mock.calls) {
      for (const argumento of chamada) {
        expect(String(argumento)).not.toContain("re_chave-secreta-nao-pode-vazar");
      }
    }
    errorSpy.mockRestore();
  });
});
