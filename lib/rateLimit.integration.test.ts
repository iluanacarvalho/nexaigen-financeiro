// lib/rateLimit.ts contra Postgres REAL (0006_rate_limit.sql): janela,
// reset, limpeza e — o que um mock não prova — atomicidade sob rajada
// concorrente. Cada teste usa um prefixo próprio (uuid), então não
// interfere em nada do banco local nem nos outros testes.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { query } from "./db";
import { aguardarLongeDaViradaDaJanela } from "@/testes/janelaRateLimit";
import { chaveLimite, desfazerTentativa, limparContadoresExpirados, registrarTentativa, zerarContador, type RegraLimite } from "./rateLimit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const PREFIXO_TESTE = `teste-rl-${randomUUID().slice(0, 8)}`;
const regra = (limite: number, janelaSegundos = 900): RegraLimite => ({ prefixo: `${PREFIXO_TESTE}:${randomUUID().slice(0, 6)}`, limite, janelaSegundos });

afterAll(async () => {
  await query(`delete from rate_limit_contador where chave like $1`, [`${PREFIXO_TESTE}:%`]);
});

// Janela fixa de 15 min (regra padrão destes testes): nunca começar a menos de 10 s da virada.
beforeEach(() => aguardarLongeDaViradaDaJanela(900, 10));

describe("registrarTentativa — Postgres real", () => {
  it("conta 1, 2, 3... e recusa a partir de limite+1, com Retry-After dentro da janela", async () => {
    const r = regra(3);
    const resultados = [];
    for (let i = 0; i < 5; i++) resultados.push(await registrarTentativa(r, "id-1"));

    expect(resultados.map((x) => [x.contagem, x.permitido])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, false],
      [5, false]
    ]);
    for (const x of resultados) {
      expect(x.retryAfterSegundos).toBeGreaterThanOrEqual(1);
      expect(x.retryAfterSegundos).toBeLessThanOrEqual(900);
    }
  });

  it("identificadores diferentes têm contadores independentes", async () => {
    const r = regra(1);
    await registrarTentativa(r, "id-a");
    expect((await registrarTentativa(r, "id-a")).permitido).toBe(false);
    expect((await registrarTentativa(r, "id-b")).permitido).toBe(true);
  });

  it("JANELA: contagem de uma janela anterior não conta na atual", async () => {
    const r = regra(2);
    await query(`insert into rate_limit_contador (chave, janela_inicio, contagem) values ($1, now() - interval '1 hour', 500)`, [chaveLimite(r.prefixo, "id-j")]);

    const atual = await registrarTentativa(r, "id-j");
    expect(atual).toMatchObject({ contagem: 1, permitido: true });
  });

  it("RESET: zerarContador apaga a chave — a próxima tentativa volta a 1", async () => {
    const r = regra(2);
    for (let i = 0; i < 4; i++) await registrarTentativa(r, "id-r");
    await zerarContador(r, "id-r");
    expect(await registrarTentativa(r, "id-r")).toMatchObject({ contagem: 1, permitido: true });
  });

  it("desfazerTentativa devolve 1 e nunca deixa o contador negativo", async () => {
    const r = regra(5);
    await registrarTentativa(r, "id-d");
    await desfazerTentativa(r, "id-d");
    await desfazerTentativa(r, "id-d");
    const [linha] = await query<{ contagem: number }>(`select contagem from rate_limit_contador where chave = $1`, [chaveLimite(r.prefixo, "id-d")]);
    expect(linha.contagem).toBe(0);
  });

  it("CONCORRÊNCIA: 50 tentativas simultâneas recebem contagens 1..50 sem repetir — exatamente `limite` permitidas", async () => {
    const r = regra(5);
    const resultados = await Promise.all(Array.from({ length: 50 }, () => registrarTentativa(r, "id-c")));

    expect(resultados.map((x) => x.contagem).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(resultados.filter((x) => x.permitido)).toHaveLength(5);
  });

  it("nunca grava o identificador em claro", async () => {
    const r = regra(5);
    await registrarTentativa(r, "pessoa-secreta@exemplo.com");
    const linhas = await query<{ chave: string }>(`select chave from rate_limit_contador where chave like $1`, [`${r.prefixo}:%`]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].chave).not.toContain("pessoa-secreta");
  });
});

describe("limparContadoresExpirados — Postgres real", () => {
  it("apaga janelas com mais de 1 dia e mantém as recentes", async () => {
    const r = regra(5);
    const velha = chaveLimite(r.prefixo, "velha");
    await query(`insert into rate_limit_contador (chave, janela_inicio, contagem) values ($1, now() - interval '2 days', 3)`, [velha]);
    await registrarTentativa(r, "recente");

    const removidas = await limparContadoresExpirados();

    expect(removidas).toBeGreaterThanOrEqual(1);
    expect(await query(`select 1 from rate_limit_contador where chave = $1`, [velha])).toHaveLength(0);
    expect(await query(`select 1 from rate_limit_contador where chave = $1`, [chaveLimite(r.prefixo, "recente")])).toHaveLength(1);
  });
});
