// Prova de que vitest.setup.sem-apis-externas.ts funciona de verdade (não
// só "existe"): roda depois do setup, com as duas camadas já ativas.

import { afterEach, describe, expect, it, vi } from "vitest";
import { CREDENCIAIS_PROVEDOR_EXTERNO } from "./vitest.setup.sem-apis-externas";

describe("camada 1 — credenciais zeradas e destinos inofensivos", () => {
  it.each(CREDENCIAIS_PROVEDOR_EXTERNO)("%s ausente do process.env", (chave) => {
    expect(process.env[chave]).toBeUndefined();
  });

  it("destinos e remetente de e-mail apontam pra example.invalid, nunca pro domínio real", () => {
    for (const chave of ["ALERTA_SISTEMA_EMAILS_DESTINO", "COBRANCA_EMAIL_DESTINO", "ALERTA_EMAIL_REMETENTE"]) {
      expect(process.env[chave]).toMatch(/@example\.invalid$/);
      expect(process.env[chave]).not.toContain("nexaigen.com.br");
    }
  });
});

describe("camada 2 — guarda no fetch, mesmo com credencial definida", () => {
  const original = process.env.RESEND_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = original;
  });

  it.each([
    ["API do Resend", "https://api.resend.com/emails"],
    ["endpoint S3 qualquer", "https://t3.storageapi.dev/bucket/objeto.pdf"]
  ])("fetch() pra %s é bloqueado antes de sair", async (_nome, url) => {
    process.env.RESEND_API_KEY = "re_chave_definida_no_teste";
    await expect(fetch(url, { method: "POST" })).rejects.toThrow(/guarda-apis-externas/);
  });

  it("o SDK real do Resend, com chave definida, também é bloqueado (ele usa fetch)", async () => {
    process.env.RESEND_API_KEY = "re_chave_definida_no_teste";
    const { Resend } = await import("resend");
    const erroConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    const resultado = await new Resend("re_chave_definida_no_teste").emails
      .send({ from: "a@example.invalid", to: "b@example.invalid", subject: "x", html: "x" })
      .catch((erro: unknown) => ({ data: null, error: erro }));
    erroConsole.mockRestore();
    expect(resultado.data).toBeNull();
    expect(String((resultado.error as { message?: string })?.message ?? resultado.error)).toMatch(/guarda-apis-externas|fetch/i);
  });

  it("localhost continua permitido (Postgres não usa fetch; isto é só o servidor local)", async () => {
    // Nada escutando nessa porta — o importante é que o erro NÃO é o da guarda.
    await expect(fetch("http://127.0.0.1:9/")).rejects.not.toThrow(/guarda-apis-externas/);
  });
});
