// Pool RESILIENTE (rodada 16-A4): conexão OCIOSA derrubada pelo servidor
// (reinício do Postgres, failover do Railway, queda de rede, 57P01) NÃO pode
// derrubar o processo. Prova num PROCESSO FILHO de verdade
// (testes/sondaPoolOcioso.ts, com o pool real de lib/db.ts): o servidor mata
// a conexão parada; o processo segue, loga UMA linha curta (código e
// mensagem, nunca a URL do banco) e a consulta seguinte funciona num cliente
// novo. Prova de mutação: sem `pool.on("error", …)` o filho cai com exceção
// não capturada (código de saída 1) e este teste falha.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { registrarErroDeConexaoOciosa } from "./db";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

describe("pool de conexões — conexão ociosa derrubada pelo servidor", () => {
  it("o processo NÃO cai; o pool descarta o cliente morto e a consulta seguinte funciona; o log tem código e mensagem, sem a URL", () => {
    const filho = spawnSync(join(process.cwd(), "node_modules", ".bin", "tsx"), [join(process.cwd(), "testes", "sondaPoolOcioso.ts")], {
      env: { ...process.env, PGAPPNAME: "teste:sonda-pool" },
      encoding: "utf-8",
      timeout: 60_000
    });
    const saida = `${filho.stdout}\n${filho.stderr}`;
    // Se falhar, a mensagem mostra a saída do filho SANEADA: a queda do pg despeja o objeto do cliente (com parâmetros de conexão).
    const saneada = saida
      .replace(/postgres(ql)?:\/\/\S+/gi, "[url ocultada]")
      .split("\n")
      .filter((l) => !/password|connectionString|user:|host:|database:/i.test(l))
      .slice(0, 15)
      .join("\n");
    expect({ codigoDeSaida: filho.status, sinal: filho.signal }, saneada).toEqual({ codigoDeSaida: 0, sinal: null });
    expect(JSON.parse(filho.stdout.trim().split("\n").at(-1)!)).toEqual({ antes: { total: 1, ociosos: 1 }, derrubou: true, descartado: true, consultaSeguinte: "ok", mesmoPid: false });
    expect(filho.stderr).toMatch(/\[db\] conexão ociosa do pool caiu \(57P01\): terminating connection due to administrator command — descartada; a próxima consulta abre outra\./);
    expect(saida).not.toContain(process.env.DATABASE_URL!); // nunca a connection string
  }, 60_000);

  it("a linha de log esconde qualquer URL de banco que vier na mensagem e corta mensagens enormes", () => {
    const linhas: string[] = [];
    const original = console.error;
    console.error = (l: string) => linhas.push(l);
    try {
      registrarErroDeConexaoOciosa(Object.assign(new Error("falhou ao falar com postgres://usuario:segredo@host:5432/banco agora"), { code: "ECONNRESET" }));
      registrarErroDeConexaoOciosa(new Error("x".repeat(500)));
    } finally {
      console.error = original;
    }
    expect(linhas[0]).toBe("[db] conexão ociosa do pool caiu (ECONNRESET): falhou ao falar com [url do banco ocultada] agora — descartada; a próxima consulta abre outra.");
    expect(linhas[0]).not.toContain("segredo");
    expect(linhas[1]).toContain("(sem código): " + "x".repeat(200) + " —");
  }, 10_000);
});
