// Perfis de acesso (rodada 15-A) contra Postgres REAL:
//   - migration 0012 aplicada 2× sobre o estado pré-0012 (transação desfeita);
//   - mudar papel: grava, derruba o access token e as sessões da pessoa,
//     mesmo papel não derruba nada, e o ÚLTIMO admin ativo não pode deixar
//     de ser admin (409) — simulado numa transação desfeita, sem tocar nas
//     contas reais do banco local;
//   - RBAC por papel nas rotas (sessão de verdade, papel lido do banco) e
//     nas páginas (layout redireciona; página inicial de boas-vindas).
// Contas de teste criadas aqui são apagadas no fim.
//   docker compose up -d && npm run migrate && npm run test:integration

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { cookieDaPagina } = vi.hoisted(() => ({ cookieDaPagina: { valor: undefined as string | undefined } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (cookieDaPagina.valor ? { value: cookieDaPagina.valor } : undefined) }) }));

import { NextRequest } from "next/server";
import { query, withTransaction } from "./db";
import { confirmarBancoTemporario, encerrarBancoTemporario } from "@/testes/bancoTemporario";
import { gerarAccessToken, NOME_COOKIE_ACCESS, obterContextoAutenticado } from "./auth";
import { alterarPapel } from "./equipeServico";
import type { Papel } from "./papeis";
import { GET as LISTAR_CLIENTES } from "@/app/api/clientes/route";
import { GET as LISTAR_EQUIPE } from "@/app/api/equipe/route";
import { PATCH as ALTERAR_PAPEL } from "@/app/api/equipe/[id]/route";
import { GET as RELATORIO } from "@/app/api/relatorios/novos-contratos/route";
import { GET as PAINEL } from "@/app/api/painel-financeiro/route";
import LayoutClientes from "@/app/(protegido)/clientes/layout";
import LayoutEquipe from "@/app/(protegido)/equipe/layout";
import LayoutContratos from "@/app/(protegido)/contratos/layout";
import LayoutCrm from "@/app/(protegido)/crm/layout";
import Inicio from "@/app/(protegido)/page";
import BoasVindas from "@/app/(protegido)/BoasVindas";
import Dashboard from "@/app/(protegido)/Dashboard";

// Este arquivo faz DDL (migration aplicada sobre estado antigo) → roda INTEIRO num banco TEMPORÁRIO (rodada 16-A3),
// nunca no compartilhado: o DDL pega trava exclusiva e ficava esperando outras conexões. vi.hoisted roda antes dos imports.
const banco = await vi.hoisted(async () => (await import("@/testes/bancoTemporario")).trocarParaBancoTemporario("papeis"));
beforeAll(() => confirmarBancoTemporario(banco, (sql) => query(sql)));
afterAll(() => encerrarBancoTemporario(banco));

const SQL_0012 = readFileSync(join(process.cwd(), "db/migrations/0012_papel_equipe.sql"), "utf-8");
const sufixo = randomUUID().slice(0, 8);
const contas: string[] = [];
class Desfazer extends Error {}

async function emTransacaoDesfeita(fn: Parameters<typeof withTransaction>[0]) {
  try {
    await withTransaction(async (c) => {
      await fn(c);
      throw new Desfazer();
    });
  } catch (erro) {
    if (!(erro instanceof Desfazer)) throw erro;
  }
}

async function criarConta(papel: Papel): Promise<{ id: string; cookie: string; token: string }> {
  const [e] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria, papel) values ($1, $2, 'x', false, $3) returning id, token_version`,
    [`Pessoa ${papel}`, `papel-${papel}-${randomUUID().slice(0, 8)}-${sufixo}@teste.nexaigen.invalid`, papel]
  );
  contas.push(e.id);
  const token = await gerarAccessToken({ equipeId: e.id, nome: `Pessoa ${papel}`, precisaTrocarSenha: false, tokenVersion: e.token_version });
  return { id: e.id, token, cookie: `${NOME_COOKIE_ACCESS}=${token}` };
}

const req = (url: string, cookie: string, metodo = "GET", corpo?: unknown) =>
  new NextRequest(`http://localhost:3001${url}`, { method: metodo, headers: { cookie, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

let pessoas: Record<Papel, { id: string; cookie: string; token: string }>;

beforeAll(async () => {
  pessoas = {
    admin: await criarConta("admin"),
    financeiro: await criarConta("financeiro"),
    vendas: await criarConta("vendas"),
    rh: await criarConta("rh"),
    contratos: await criarConta("contratos"),
    implantacao: await criarConta("implantacao")
  };
});

afterAll(async () => {
  await query(`delete from equipe_nexaigen where id = any($1::uuid[])`, [contas]);
});

describe.skipIf(!banco)("migration 0012 — Postgres real (banco temporário)", () => {
  it("aplicada 2× sobre o estado pré-0012: quem existia vira admin; CHECK recusa papel fora da lista; default admin", async () => {
    await emTransacaoDesfeita(async (c) => {
      await c.query(`alter table equipe_nexaigen drop column papel`);
      await c.query(SQL_0012);
      await c.query(SQL_0012); // idempotente
      const { rows } = await c.query<{ papel: string; n: number }>(`select papel, count(*)::int as n from equipe_nexaigen group by papel`);
      expect(rows.map((r) => r.papel)).toEqual(["admin"]);
      const { rows: checks } = await c.query(`select 1 from pg_constraint where conname = 'ck_equipe_nexaigen_papel'`);
      expect(checks).toHaveLength(1);
      await c.query("savepoint s");
      await expect(c.query(`update equipe_nexaigen set papel = 'diretor'`)).rejects.toMatchObject({ code: "23514", constraint: "ck_equipe_nexaigen_papel" });
      await c.query("rollback to savepoint s");
      const { rows: [nova] } = await c.query<{ papel: string }>(`insert into equipe_nexaigen (nome, email, senha_hash) values ('Bootstrap', $1, 'x') returning papel`, [`bootstrap-${sufixo}@teste.nexaigen.invalid`]);
      expect(nova.papel).toBe("admin");
    });
  });
});

describe("mudar papel — Postgres real", () => {
  it("admin muda o papel de outra pessoa: grava, invalida o token na hora e revoga as sessões; mesmo papel não derruba nada", async () => {
    const alvo = await criarConta("financeiro");
    await query(`insert into sessao (equipe_id, refresh_token_hash, expira_em) values ($1, $2, now() + interval '1 day')`, [alvo.id, `hash-${randomUUID()}`]);
    expect((await obterContextoAutenticado(alvo.token))?.papel).toBe("financeiro");

    const mesmo = await ALTERAR_PAPEL(req(`/api/equipe/${alvo.id}`, pessoas.admin.cookie, "PATCH", { papel: "financeiro" }), { params: Promise.resolve({ id: alvo.id }) });
    expect(await mesmo.json()).toEqual({ papel: "financeiro", mudou: false, sessaoEncerrada: false });
    expect(await obterContextoAutenticado(alvo.token)).not.toBeNull();

    const res = await ALTERAR_PAPEL(req(`/api/equipe/${alvo.id}`, pessoas.admin.cookie, "PATCH", { papel: "vendas" }), { params: Promise.resolve({ id: alvo.id }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ papel: "vendas", mudou: true, sessaoEncerrada: false });
    const [linha] = await query<{ papel: string }>(`select papel from equipe_nexaigen where id = $1`, [alvo.id]);
    expect(linha.papel).toBe("vendas");
    expect(await obterContextoAutenticado(alvo.token)).toBeNull(); // token antigo morto (token_version)
    const sessoes = await query<{ revogado_em: string | null }>(`select revogado_em from sessao where equipe_id = $1`, [alvo.id]);
    expect(sessoes.every((s) => s.revogado_em !== null)).toBe(true);
  });

  it("financeiro não muda papel (403); pessoa inexistente → 404; papel inválido → 400", async () => {
    const alvo = pessoas.vendas.id;
    expect((await ALTERAR_PAPEL(req(`/api/equipe/${alvo}`, pessoas.financeiro.cookie, "PATCH", { papel: "admin" }), { params: Promise.resolve({ id: alvo }) })).status).toBe(403);
    const fantasma = randomUUID();
    expect((await ALTERAR_PAPEL(req(`/api/equipe/${fantasma}`, pessoas.admin.cookie, "PATCH", { papel: "rh" }), { params: Promise.resolve({ id: fantasma }) })).status).toBe(404);
    expect((await ALTERAR_PAPEL(req(`/api/equipe/${alvo}`, pessoas.admin.cookie, "PATCH", { papel: "dono" }), { params: Promise.resolve({ id: alvo }) })).status).toBe(400);
  });

  it("último admin ativo não deixa de ser admin; com dois admins, um pode rebaixar o outro (transação desfeita)", async () => {
    await emTransacaoDesfeita(async (c) => {
      const unico = pessoas.admin.id;
      // Dentro desta transação (desfeita no fim) só `unico` é admin ativo.
      await c.query(`update equipe_nexaigen set ativo = false where papel = 'admin' and id <> $1`, [unico]);
      expect(await alterarPapel(unico, "financeiro", c)).toEqual({ ok: false, motivo: "ultimo_admin" });

      // Admin INATIVO não conta como "o outro admin".
      const { rows: [inativo] } = await c.query<{ id: string }>(
        `insert into equipe_nexaigen (nome, email, senha_hash, papel, ativo) values ('Inativo', $1, 'x', 'admin', false) returning id`,
        [`inativo-${sufixo}@teste.nexaigen.invalid`]
      );
      expect(await alterarPapel(unico, "rh", c)).toEqual({ ok: false, motivo: "ultimo_admin" });
      // Rebaixar um admin inativo não reduz o número de admins ativos — permitido.
      expect(await alterarPapel(inativo.id, "rh", c)).toMatchObject({ ok: true, mudou: true });

      const { rows: [outro] } = await c.query<{ id: string }>(`insert into equipe_nexaigen (nome, email, senha_hash, papel) values ('Outro admin', $1, 'x', 'admin') returning id`, [`outro-${sufixo}@teste.nexaigen.invalid`]);
      expect(await alterarPapel(unico, "financeiro", c)).toMatchObject({ ok: true, mudou: true });
      expect(await alterarPapel(outro.id, "financeiro", c)).toEqual({ ok: false, motivo: "ultimo_admin" });
    });
  });
});

describe("RBAC por papel nas rotas — sessão real, papel lido do banco", () => {
  it.each([
    ["admin", { clientes: 200, equipe: 200, relatorio: 200, painel: 200 }],
    ["financeiro", { clientes: 200, equipe: 403, relatorio: 200, painel: 200 }],
    ["vendas", { clientes: 403, equipe: 403, relatorio: 403, painel: 403 }],
    ["rh", { clientes: 403, equipe: 403, relatorio: 403, painel: 403 }]
  ] as const)("%s", async (papel, esperado) => {
    const { cookie } = pessoas[papel];
    expect((await LISTAR_CLIENTES(req("/api/clientes", cookie))).status).toBe(esperado.clientes);
    expect((await LISTAR_EQUIPE(req("/api/equipe", cookie))).status).toBe(esperado.equipe);
    expect((await RELATORIO(req("/api/relatorios/novos-contratos?formato=csv", cookie))).status).toBe(esperado.relatorio);
    expect((await PAINEL(req("/api/painel-financeiro", cookie))).status).toBe(esperado.painel);
  });

  it("GET /api/equipe devolve o papel de cada pessoa (nunca o hash)", async () => {
    const { colegas } = await (await LISTAR_EQUIPE(req("/api/equipe", pessoas.admin.cookie))).json();
    const rh = colegas.find((c: { id: string }) => c.id === pessoas.rh.id);
    expect(rh.papel).toBe("rh");
    expect(rh.senha_hash).toBeUndefined();
  });
});

describe("RBAC nas páginas — layout redireciona, página inicial por papel", () => {
  const destinoDoRedirect = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      await fn();
      return null;
    } catch (erro) {
      const digest = (erro as { digest?: string }).digest ?? "";
      if (!digest.startsWith("NEXT_REDIRECT")) throw erro;
      return digest.split(";")[2];
    }
  };
  const filho = { children: "conteúdo" };

  it("sem sessão → /login; vendas em Clientes/Contratos → /; financeiro em Equipe → /; com acesso → renderiza", async () => {
    cookieDaPagina.valor = undefined;
    expect(await destinoDoRedirect(() => LayoutClientes(filho))).toBe("/login");

    cookieDaPagina.valor = pessoas.vendas.token;
    expect(await destinoDoRedirect(() => LayoutClientes(filho))).toBe("/");
    expect(await destinoDoRedirect(() => LayoutContratos(filho))).toBe("/");

    cookieDaPagina.valor = pessoas.financeiro.token;
    expect(await destinoDoRedirect(() => LayoutEquipe(filho))).toBe("/");
    expect(await destinoDoRedirect(() => LayoutClientes(filho))).toBeNull();
    expect(await destinoDoRedirect(() => LayoutContratos(filho))).toBeNull();

    cookieDaPagina.valor = pessoas.admin.token;
    expect(await destinoDoRedirect(() => LayoutEquipe(filho))).toBeNull();
  });

  it("CRM (rodada 16-A): vendas e admin entram; financeiro e rh → /", async () => {
    for (const [papel, destino] of [["vendas", null], ["admin", null], ["financeiro", "/"], ["rh", "/"]] as const) {
      cookieDaPagina.valor = pessoas[papel].token;
      expect({ papel, destino: await destinoDoRedirect(() => LayoutCrm(filho)) }).toEqual({ papel, destino });
    }
  });

  it("página inicial: vendas/rh → boas-vindas; financeiro/admin → Dashboard", async () => {
    for (const [papel, componente] of [["vendas", BoasVindas], ["rh", BoasVindas], ["financeiro", Dashboard], ["admin", Dashboard]] as const) {
      cookieDaPagina.valor = pessoas[papel].token;
      expect((await Inicio()).type).toBe(componente);
    }
  });
});
