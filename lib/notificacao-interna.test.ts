import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();
// mockImplementation precisa de uma function tradicional (não arrow) — o
// código real chama `new Resend(apiKey)`, e uma arrow function não pode
// ser invocada com `new`.
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function ResendMock() {
    return { emails: { send: sendMock } };
  })
}));

// lib/alertaErroSistema.ts importa lib/db.ts (pg real) — sem mockar aqui,
// este teste puro (sem Postgres nenhum rodando) quebraria na importação
// assim que notificacao-interna.ts passasse a chamar alertarErroSistema
// (rodada de alerta de falha de sistema). Mesmo raciocínio de todo outro
// teste deste projeto que mocka @/lib/db antes de importar um módulo que
// o toca, indiretamente ou não.
//
// vi.hoisted (não `const` solto): vi.mock() é hoisted pro TOPO do
// arquivo, antes de QUALQUER outro statement — um `const` comum
// referenciado na factory lançaria "Cannot access before initialization".
const { alertarErroSistemaMock } = vi.hoisted(() => ({
  alertarErroSistemaMock: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("./alertaErroSistema", () => ({ alertarErroSistema: alertarErroSistemaMock }));

import { notificarTimeDeCobranca } from "./notificacao-interna";

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
  alertarErroSistemaMock.mockClear();
});

afterEach(() => {
  restaurarEnv("RESEND_API_KEY", ENV_ORIGINAL.resendApiKey);
  restaurarEnv("COBRANCA_EMAIL_DESTINO", ENV_ORIGINAL.destino);
  restaurarEnv("ALERTA_EMAIL_REMETENTE", ENV_ORIGINAL.remetente);
  vi.clearAllMocks();
});

const ALERTA = {
  tipo: "atraso_60_dias",
  clienteNome: "Prefeitura Municipal de Jaguapitã",
  numeroNf: "NF-1234",
  valor: 4500,
  diasDeAtraso: 64
};

describe("notificarTimeDeCobranca — RESEND_API_KEY ausente", () => {
  it("não chama o client do Resend, nunca lança, alerta falha de sistema (categoria resend_interno)", async () => {
    limparEnv();
    process.env.COBRANCA_EMAIL_DESTINO = "financeiro@nexaigen.com.br";

    await expect(notificarTimeDeCobranca(ALERTA)).resolves.toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(alertarErroSistemaMock).toHaveBeenCalledWith("resend_interno", expect.any(String));
  });
});

describe("notificarTimeDeCobranca — COBRANCA_EMAIL_DESTINO ausente", () => {
  it("não chama o client do Resend, nunca lança, alerta falha de sistema (mesmo com RESEND_API_KEY presente)", async () => {
    limparEnv();
    process.env.RESEND_API_KEY = "re_teste_fake";

    await expect(notificarTimeDeCobranca(ALERTA)).resolves.toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(alertarErroSistemaMock).toHaveBeenCalledWith("resend_interno", expect.any(String));
  });
});

describe("notificarTimeDeCobranca — configuração completa", () => {
  it("chama emails.send com from/to/assunto/html esperados (HTML, não mais texto puro) e devolve true (enviado)", async () => {
    configurarEnvCompleto();

    await expect(notificarTimeDeCobranca(ALERTA)).resolves.toBe(true);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.from).toBe("alertas@nexaigen.com.br");
    expect(payload.to).toEqual(["financeiro@nexaigen.com.br"]);
    expect(payload.subject).toContain(ALERTA.clienteNome);
    expect(payload.html).toContain("NEXAIGEN");
    expect(payload.html).toContain(ALERTA.clienteNome);
    expect(payload.html).toContain(ALERTA.numeroNf!);
    expect(payload.html).toContain("4500.00");
    expect(payload.html).toContain("64");
    expect(payload.text).toBeUndefined();
  });

  it("COBRANCA_EMAIL_DESTINO com múltiplos e-mails separados por vírgula — todos viram destinatários", async () => {
    configurarEnvCompleto();
    process.env.COBRANCA_EMAIL_DESTINO = "financeiro@nexaigen.com.br, cobranca@nexaigen.com.br ,  outra@nexaigen.com.br";

    await notificarTimeDeCobranca(ALERTA);

    const payload = sendMock.mock.calls[0][0];
    expect(payload.to).toEqual(["financeiro@nexaigen.com.br", "cobranca@nexaigen.com.br", "outra@nexaigen.com.br"]);
  });

  it("erro devolvido pela API do Resend (error != null) não lança — só loga e alerta falha de sistema", async () => {
    configurarEnvCompleto();
    sendMock.mockResolvedValue({ data: null, error: { message: "chave inválida", statusCode: 401, name: "invalid_api_key" } });

    await expect(notificarTimeDeCobranca(ALERTA)).resolves.toBe(false);
    expect(alertarErroSistemaMock).toHaveBeenCalledWith("resend_interno", expect.any(String));
  });

  it("exceção lançada pelo client (rede/timeout) não propaga — nunca lança (achado corrigido nesta rodada), alerta falha de sistema", async () => {
    configurarEnvCompleto();
    sendMock.mockRejectedValue(new Error("erro de rede simulado"));

    await expect(notificarTimeDeCobranca(ALERTA)).resolves.toBe(false);
    expect(alertarErroSistemaMock).toHaveBeenCalledWith("resend_interno", expect.any(String));
  });

  it("nunca loga a RESEND_API_KEY", async () => {
    configurarEnvCompleto();
    process.env.RESEND_API_KEY = "re_chave-secreta-nao-pode-vazar";
    sendMock.mockRejectedValue(new Error("erro de rede simulado"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await notificarTimeDeCobranca(ALERTA);

    for (const chamada of errorSpy.mock.calls) {
      for (const argumento of chamada) {
        expect(String(argumento)).not.toContain("re_chave-secreta-nao-pode-vazar");
      }
    }
    errorSpy.mockRestore();
  });
});
