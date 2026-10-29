// Testes unitários de lib/rateLimit.ts — funções puras e a decisão de
// limite com `query` mockado. Janela real, reset e concorrência contra
// Postgres de verdade: lib/rateLimit.integration.test.ts.

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("./db", () => ({ query: queryMock }));

import {
  LIMITE_LOGIN_POR_EMAIL,
  chaveLimite,
  desfazerTentativa,
  normalizarEmail,
  obterIpCliente,
  registrarTentativa,
  respostaLimiteExcedido,
  zerarContador
} from "./rateLimit";

beforeEach(() => queryMock.mockReset());

describe("chaveLimite — nunca guarda o identificador em claro", () => {
  it("prefixo + sha256 hex", () => {
    const chave = chaveLimite("login:email", "pessoa@exemplo.com");
    expect(chave).toBe(`login:email:${createHash("sha256").update("pessoa@exemplo.com").digest("hex")}`);
    expect(chave).not.toContain("pessoa@exemplo.com");
  });

  it("prefixos diferentes nunca colidem pro mesmo identificador", () => {
    expect(chaveLimite("login:ip", "1.2.3.4")).not.toBe(chaveLimite("integracao:ip", "1.2.3.4"));
  });
});

describe("normalizarEmail", () => {
  it("apara e põe em minúsculas — mesma conta, mesmo contador", () => {
    expect(normalizarEmail("  Pessoa@Exemplo.COM ")).toBe("pessoa@exemplo.com");
  });
});

describe("obterIpCliente", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost/x", { headers });

  it.each([
    [{ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" }, "203.0.113.7"],
    [{ "x-forwarded-for": "  203.0.113.8  " }, "203.0.113.8"],
    [{ "x-real-ip": "198.51.100.1" }, "198.51.100.1"],
    [{ "x-forwarded-for": "", "x-real-ip": "198.51.100.2" }, "198.51.100.2"],
    [{}, "desconhecido"],
    [{ "x-forwarded-for": "x".repeat(65) }, "desconhecido"]
  ])("%j → %s", (headers, esperado) => {
    expect(obterIpCliente(req(headers))).toBe(esperado);
  });
});

describe("registrarTentativa — decisão de limite", () => {
  it.each([
    [1, true],
    [5, true],
    [6, false],
    [50, false]
  ])("contagem %i com limite 5 → permitido=%s", async (contagem, permitido) => {
    queryMock.mockResolvedValue([{ contagem, retry_after: 300 }]);
    expect(await registrarTentativa(LIMITE_LOGIN_POR_EMAIL, "a@b.c")).toEqual({ permitido, contagem, retryAfterSegundos: 300 });
  });

  it("incrementa e lê numa instrução só (insert ... on conflict do update ... returning), com a chave hasheada e a janela", async () => {
    queryMock.mockResolvedValue([{ contagem: 1, retry_after: 900 }]);
    await registrarTentativa(LIMITE_LOGIN_POR_EMAIL, "a@b.c");
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/insert into rate_limit_contador[\s\S]*on conflict \(chave, janela_inicio\) do update set contagem = rate_limit_contador\.contagem \+ 1[\s\S]*returning/);
    expect(params).toEqual([chaveLimite("login:email", "a@b.c"), 900]);
  });

  it("Retry-After nunca é menor que 1 segundo", async () => {
    queryMock.mockResolvedValue([{ contagem: 9, retry_after: 0 }]);
    expect((await registrarTentativa(LIMITE_LOGIN_POR_EMAIL, "a@b.c")).retryAfterSegundos).toBe(1);
  });

  it("desfazerTentativa nunca deixa negativo; zerarContador apaga só aquela chave", async () => {
    queryMock.mockResolvedValue([]);
    await desfazerTentativa(LIMITE_LOGIN_POR_EMAIL, "a@b.c");
    expect(queryMock.mock.calls[0][0]).toContain("greatest(contagem - 1, 0)");
    await zerarContador(LIMITE_LOGIN_POR_EMAIL, "a@b.c");
    expect(queryMock.mock.calls[1]).toEqual([`delete from rate_limit_contador where chave = $1`, [chaveLimite("login:email", "a@b.c")], undefined]);
  });
});

describe("respostaLimiteExcedido", () => {
  it("429 + Retry-After em segundos + mensagem genérica em minutos", async () => {
    const res = respostaLimiteExcedido(301);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("301");
    expect(await res.json()).toEqual({ erro: "Muitas tentativas. Tente novamente em 6 minutos." });
    expect((await respostaLimiteExcedido(30).json()).erro).toContain("1 minuto.");
  });
});
