// Testes unitários de lib/statusConfiguracao.ts — só booleanos saem, nunca valores.

import { describe, expect, it } from "vitest";
import { avisosDeConfiguracao, lerStatusConfiguracao, VARIAVEIS_BUCKET } from "./statusConfiguracao";

const SENTINELA = "SENTINELA-valor-secreto-9f3a";
const COMPLETO: Record<string, string> = {
  RESEND_API_KEY: `${SENTINELA}-resend`,
  ALERTA_EMAIL_REMETENTE: `${SENTINELA}-remetente`,
  ALERTA_SISTEMA_EMAILS_DESTINO: `${SENTINELA}-alerta`,
  COBRANCA_EMAIL_DESTINO: `${SENTINELA}-cobranca`,
  RAILWAY_BUCKET_NAME: `${SENTINELA}-bucket`,
  RAILWAY_BUCKET_ACCESS_KEY_ID: `${SENTINELA}-ak`,
  RAILWAY_BUCKET_SECRET_ACCESS_KEY: `${SENTINELA}-sk`,
  RAILWAY_BUCKET_ENDPOINT: `${SENTINELA}-endpoint`,
  CRON_SECRET: `${SENTINELA}-cron`,
  INTEGRACAO_SECRET: `${SENTINELA}-integracao`,
  JWT_SECRET: `${SENTINELA}-jwt`
};

describe("lerStatusConfiguracao", () => {
  it("tudo configurado → todos true, e o resultado só tem booleanos (nenhum valor-sentinela)", () => {
    const status = lerStatusConfiguracao(COMPLETO);
    expect(Object.values(status).every((v) => v === true)).toBe(true);
    expect(Object.values(status).every((v) => typeof v === "boolean")).toBe(true);
    expect(JSON.stringify(status)).not.toContain(SENTINELA);
    expect(avisosDeConfiguracao(status)).toEqual([]);
  });

  it("ambiente vazio → todos false", () => {
    expect(Object.values(lerStatusConfiguracao({})).every((v) => v === false)).toBe(true);
  });

  it("vazio ou só espaços conta como ausente", () => {
    expect(lerStatusConfiguracao({ ...COMPLETO, RESEND_API_KEY: "   " }).resendApiKey).toBe(false);
    expect(lerStatusConfiguracao({ ...COMPLETO, JWT_SECRET: "" }).jwtSecret).toBe(false);
  });

  it.each(VARIAVEIS_BUCKET)("bucket incompleto sem %s", (nome) => {
    expect(lerStatusConfiguracao({ ...COMPLETO, [nome]: undefined }).bucketCompleto).toBe(false);
  });

  it("CRON_SECRET com o texto de exemplo do .env.example conta como não configurado", () => {
    expect(lerStatusConfiguracao({ ...COMPLETO, CRON_SECRET: "troque-por-um-valor-aleatorio-longo" }).cronSecret).toBe(false);
  });
});

describe("avisosDeConfiguracao", () => {
  it("sem Resend → um aviso de e-mail (não um por variável) e nenhum valor no texto", () => {
    const avisos = avisosDeConfiguracao(lerStatusConfiguracao({ ...COMPLETO, RESEND_API_KEY: undefined, COBRANCA_EMAIL_DESTINO: undefined }));
    expect(avisos).toEqual([expect.stringMatching(/^E-mails não serão enviados.*RESEND_API_KEY/)]);
    expect(avisos.join(" ")).not.toContain(SENTINELA);
  });

  it("com Resend mas sem destinos → avisa os destinos que faltam", () => {
    const avisos = avisosDeConfiguracao(lerStatusConfiguracao({ ...COMPLETO, COBRANCA_EMAIL_DESTINO: undefined, ALERTA_SISTEMA_EMAILS_DESTINO: undefined }));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("COBRANCA_EMAIL_DESTINO");
    expect(avisos[0]).toContain("ALERTA_SISTEMA_EMAILS_DESTINO");
  });

  it("cada funcionalidade ausente tem o seu aviso", () => {
    const avisos = avisosDeConfiguracao(lerStatusConfiguracao({}));
    expect(avisos.join("\n")).toMatch(/RESEND_API_KEY[\s\S]*RAILWAY_BUCKET[\s\S]*CRON_SECRET[\s\S]*INTEGRACAO_SECRET[\s\S]*JWT_SECRET/);
  });
});
