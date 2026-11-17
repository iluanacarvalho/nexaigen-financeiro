// GET /api/configuracao/status — 401 sem sessão, e com sessão devolve só
// booleanos: nenhum valor-sentinela aparece no corpo, nos headers nem em
// nenhum console.* durante a chamada.

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "chave-de-teste-jwt-apenas-unitario";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: queryMock }));

import { NextRequest } from "next/server";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { GET } from "./route";

const SENTINELA = "SENTINELA-nao-pode-vazar-7c21";
const NOMES = [
  "RESEND_API_KEY",
  "ALERTA_EMAIL_REMETENTE",
  "ALERTA_SISTEMA_EMAILS_DESTINO",
  "COBRANCA_EMAIL_DESTINO",
  "RAILWAY_BUCKET_NAME",
  "RAILWAY_BUCKET_ACCESS_KEY_ID",
  "RAILWAY_BUCKET_SECRET_ACCESS_KEY",
  "RAILWAY_BUCKET_ENDPOINT",
  "CRON_SECRET",
  "INTEGRACAO_SECRET"
];
const originais: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const nome of NOMES) {
    originais[nome] = process.env[nome];
    process.env[nome] = `${SENTINELA}-${nome}`;
  }
  queryMock.mockReset();
  queryMock.mockResolvedValue([{ token_version: 1, ativo: true, papel: "admin" }]);
});

afterEach(() => {
  for (const nome of NOMES) {
    if (originais[nome] === undefined) delete process.env[nome];
    else process.env[nome] = originais[nome];
  }
  vi.restoreAllMocks();
});

describe("GET /api/configuracao/status", () => {
  it("sem sessão — 401, sem nenhum dado", async () => {
    const res = await GET(new NextRequest("http://localhost:3001/api/configuracao/status"));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(SENTINELA);
  });

  it("com sessão — só booleanos; nenhum valor-sentinela no corpo, nos headers nem nos logs", async () => {
    const espioes = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const token = await gerarAccessToken({ equipeId: "equipe-1", nome: "Teste", precisaTrocarSenha: false, tokenVersion: 1 });

    const res = await GET(new NextRequest("http://localhost:3001/api/configuracao/status", { headers: { cookie: `${NOME_COOKIE_ACCESS}=${token}` } }));
    const texto = await res.text();
    const corpo = JSON.parse(texto);

    expect(res.status).toBe(200);
    expect(texto).not.toContain(SENTINELA);
    expect(JSON.stringify([...res.headers.entries()])).not.toContain(SENTINELA);
    expect(Object.values(corpo.status).every((v) => typeof v === "boolean")).toBe(true);
    expect(corpo.status).toMatchObject({ resendApiKey: true, bucketCompleto: true, cronSecret: true, integracaoSecret: true, jwtSecret: true });
    expect(corpo.avisos).toEqual([]);
    for (const espiao of espioes) {
      expect(JSON.stringify(espiao.mock.calls)).not.toContain(SENTINELA);
    }
  });

  it("com sessão e variáveis faltando — avisos em linguagem simples, ainda sem valores", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RAILWAY_BUCKET_ENDPOINT;
    const token = await gerarAccessToken({ equipeId: "equipe-1", nome: "Teste", precisaTrocarSenha: false, tokenVersion: 1 });

    const res = await GET(new NextRequest("http://localhost:3001/api/configuracao/status", { headers: { cookie: `${NOME_COOKIE_ACCESS}=${token}` } }));
    const texto = await res.text();

    expect(JSON.parse(texto).avisos).toEqual([expect.stringMatching(/^E-mails não serão enviados/), expect.stringMatching(/^PDFs/)]);
    expect(texto).not.toContain(SENTINELA);
  });
});
