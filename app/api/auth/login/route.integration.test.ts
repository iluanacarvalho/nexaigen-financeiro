// Limite de tentativas de login e troca de senha contra Postgres REAL
// (rotas reais, bcrypt real, contadores reais em rate_limit_contador).
// Cada cenário usa e-mails e IPs próprios (uuid no IP via x-forwarded-for),
// então os contadores de um cenário nunca afetam outro.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { NOME_COOKIE_ACCESS, gerarAccessToken, hashSenha } from "@/lib/auth";
import { chaveLimite } from "@/lib/rateLimit";
import { POST as LOGIN } from "./route";
import { POST as TROCAR_SENHA } from "../trocar-senha/route";
import { aguardarLongeDaViradaDaJanela } from "@/testes/janelaRateLimit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const SENHA = "senha-correta-123";
const sufixo = randomUUID().slice(0, 8);
const contas: { id: string; email: string; tokenVersion: number }[] = [];
const identificadoresUsados: string[] = [];

async function criarConta(rotulo: string) {
  const email = `login-${rotulo}-${sufixo}@teste.nexaigen.invalid`;
  const [linha] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria) values ($1, $2, $3, false) returning id, token_version`,
    [`Teste ${rotulo}`, email, await hashSenha(SENHA)]
  );
  const conta = { id: linha.id, email, tokenVersion: linha.token_version };
  contas.push(conta);
  return conta;
}

function novoIp(): string {
  const ip = `teste-ip-${randomUUID()}`;
  identificadoresUsados.push(ip);
  return ip;
}

function login(email: string, senha: string, ip: string) {
  identificadoresUsados.push(email.toLowerCase());
  return LOGIN(
    new NextRequest("http://localhost:3001/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email, senha })
    })
  );
}

beforeAll(async () => {
  await criarConta("bloqueio");
});

// Janela fixa de 15 min: nunca começar um cenário a menos de 20 s da virada (ver testes/janelaRateLimit.ts; cada cenário leva poucos segundos, e a espera cabe no hookTimeout de 30 s).
beforeEach(() => aguardarLongeDaViradaDaJanela(15 * 60, 20));

afterAll(async () => {
  const chaves = identificadoresUsados.flatMap((id) => ["login:email", "login:ip", "trocar-senha:equipe"].map((p) => chaveLimite(p, id)));
  chaves.push(...contas.map((c) => chaveLimite("trocar-senha:equipe", c.id)));
  await query(`delete from rate_limit_contador where chave = any($1::text[])`, [chaves]);
  await query(`delete from equipe_nexaigen where id = any($1::uuid[])`, [contas.map((c) => c.id)]);
});

describe("POST /api/auth/login — 5 falhas em 15 min", () => {
  it("5 senhas erradas → 401 genérico; a 6ª tentativa → 429 com Retry-After, mesmo com a senha CERTA", async () => {
    const [conta] = contas;
    const ip = novoIp();

    for (let i = 1; i <= 5; i++) {
      const res = await login(conta.email, `errada-${i}`, ip);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ erro: "E-mail ou senha inválidos." });
    }

    const sexta = await login(conta.email, SENHA, ip);
    expect(sexta.status).toBe(429);
    const retryAfter = Number(sexta.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    expect((await sexta.json()).erro).toMatch(/Muitas tentativas/);
  });

  it("o bloqueio é por E-MAIL: o mesmo e-mail continua bloqueado vindo de outro IP", async () => {
    const [conta] = contas;
    expect((await login(conta.email.toUpperCase(), SENHA, novoIp())).status).toBe(429); // normalizado: mesma conta
  });

  it("e-mails diferentes têm contadores independentes", async () => {
    const outra = await criarConta("independente");
    const res = await login(outra.email, SENHA, novoIp());
    expect(res.status).toBe(200);
  });

  it("sucesso ZERA o contador do e-mail: 4 falhas + acerto → mais 5 falhas ainda são 401 antes do 429", async () => {
    const conta = await criarConta("reset");
    const ip = novoIp();
    for (let i = 0; i < 4; i++) expect((await login(conta.email, "errada", ip)).status).toBe(401);
    expect((await login(conta.email, SENHA, ip)).status).toBe(200);

    // IP novo pra isolar só o contador do e-mail (o do IP também foi devolvido no acerto).
    const ip2 = novoIp();
    for (let i = 0; i < 5; i++) expect((await login(conta.email, "errada", ip2)).status).toBe(401);
    expect((await login(conta.email, "errada", ip2)).status).toBe(429);
  });

  it("limite por IP: 5 falhas com e-mails diferentes do mesmo IP → a 6ª é 429", async () => {
    const ip = novoIp();
    for (let i = 0; i < 5; i++) {
      expect((await login(`nao-existe-${i}-${sufixo}@teste.nexaigen.invalid`, "x", ip)).status).toBe(401);
    }
    expect((await login(`nao-existe-6-${sufixo}@teste.nexaigen.invalid`, "x", ip)).status).toBe(429);
  });

  it("acerto de um colega no mesmo IP não consome a cota de falhas do IP", async () => {
    const conta = await criarConta("colega");
    const ip = novoIp();
    for (let i = 0; i < 4; i++) expect((await login(`desconhecido-${i}-${sufixo}@teste.nexaigen.invalid`, "x", ip)).status).toBe(401);
    for (let i = 0; i < 3; i++) expect((await login(conta.email, SENHA, ip)).status).toBe(200);
    expect((await login(`desconhecido-5-${sufixo}@teste.nexaigen.invalid`, "x", ip)).status).toBe(401); // 5ª falha: ainda 401
  });

  it("e-mail inexistente: mesma resposta E tempo da mesma ordem de uma senha errada (verificação bcrypt fantasma)", async () => {
    const conta = await criarConta("tempo");
    const medir = async (email: string) => {
      const inicio = performance.now();
      const res = await login(email, "senha-qualquer", novoIp());
      return { ms: performance.now() - inicio, status: res.status, corpo: await res.json() };
    };

    const inexistente = await medir(`nunca-existiu-${sufixo}@teste.nexaigen.invalid`);
    const senhaErrada = await medir(conta.email);

    expect(inexistente.status).toBe(401);
    expect(inexistente.corpo).toEqual(senhaErrada.corpo);
    // Sem o hash fantasma, o inexistente levava ~1% do tempo do bcrypt. Margem larga pra não ser instável.
    expect(inexistente.ms).toBeGreaterThan(senhaErrada.ms * 0.4);
  });
});

describe("POST /api/auth/trocar-senha — 10 tentativas por conta em 15 min", () => {
  it("10 tentativas com senha atual errada → 400; a 11ª → 429", async () => {
    const conta = await criarConta("trocar");
    const token = await gerarAccessToken({ equipeId: conta.id, nome: "Teste trocar", precisaTrocarSenha: false, tokenVersion: conta.tokenVersion });
    const trocar = () =>
      TROCAR_SENHA(
        new NextRequest("http://localhost:3001/api/auth/trocar-senha", {
          method: "POST",
          headers: { "content-type": "application/json", cookie: `${NOME_COOKIE_ACCESS}=${token}` },
          body: JSON.stringify({ senha_atual: "errada", nova_senha: "novaSenha123" })
        })
      );

    for (let i = 0; i < 10; i++) expect((await trocar()).status).toBe(400);
    const decima_primeira = await trocar();
    expect(decima_primeira.status).toBe(429);
    expect(decima_primeira.headers.get("retry-after")).toBeTruthy();
  });

  it("sem sessão → 401 (o limite nem é consultado)", async () => {
    const res = await TROCAR_SENHA(
      new NextRequest("http://localhost:3001/api/auth/trocar-senha", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    );
    expect(res.status).toBe(401);
  });
});
