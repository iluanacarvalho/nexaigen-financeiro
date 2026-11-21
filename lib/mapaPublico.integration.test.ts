// Mapa público (rodada 15-B) contra Postgres REAL:
//   - migration 0013 aplicada 2× sobre o estado pré-0013 (transação desfeita);
//   - regra de quem aparece (serviço + leitura pública na MESMA transação
//     desfeita): sem autorização não; autorizado e ativo sim; autorizado mas
//     encerrado/suspenso não; aviso vigente sim; revogar tira na hora; CHECK
//     impede autorizar sem posição; código duplicado recusado; eventos
//     gravados com autor; eventos de divulgação NÃO atrapalham a lógica de
//     contrato (relatório de aviso prévio);
//   - rotas reais com sessão: PUT interno (403 pra vendas/rh; IBGE
//     bloqueado nos testes ⇒ "posição pendente"), e o GET público sem
//     sessão com exatamente as 4 chaves por município e os cabeçalhos.
// Nenhuma chamada de rede real (vitest.setup.sem-apis-externas.ts).
//   docker compose up -d && npm run migrate && npm run test:integration

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PoolClient } from "pg";

vi.mock("./alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));

import { NextRequest } from "next/server";
import { query, withTransaction } from "./db";
import { confirmarBancoTemporario, encerrarBancoTemporario } from "@/testes/bancoTemporario";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "./auth";
import { autorizarDivulgacao, definirCodigoIbge, revogarDivulgacao } from "./divulgacaoServico";
import { registrarCancelamento, retratarCancelamento } from "./cancelamentoServico";
import { obterMapaPublico } from "./mapaPublicoRepositorio";
import { obterRelatorioContratos } from "./relatorioContratosRepositorio";
import { chaveLimite } from "./rateLimit";
import { hojeEmSaoPaulo } from "./painelFinanceiro";
import { PUT as DIVULGACAO } from "@/app/api/clientes/[id]/divulgacao/route";
import { GET as MAPA_PUBLICO } from "@/app/api/publico/mapa-clientes/route";

// Este arquivo faz DDL (migration aplicada sobre estado antigo) → roda INTEIRO num banco TEMPORÁRIO (rodada 16-A3),
// nunca no compartilhado: o DDL pega trava exclusiva e ficava esperando outras conexões. vi.hoisted roda antes dos imports.
const banco = await vi.hoisted(async () => (await import("@/testes/bancoTemporario")).trocarParaBancoTemporario("mapa"));
beforeAll(() => confirmarBancoTemporario(banco, (sql) => query(sql)));
afterAll(() => encerrarBancoTemporario(banco));

const SQL_0013 = readFileSync(join(process.cwd(), "db/migrations/0013_cliente_mapa_publico.sql"), "utf-8");
const AGORA = new Date("2026-11-17T15:00:00Z");
const HOJE = "2026-11-17";
const sufixo = randomUUID().slice(0, 8);
class Desfazer extends Error {}

async function emTransacaoDesfeita(fn: (c: PoolClient) => Promise<void>) {
  try {
    await withTransaction(async (c) => {
      await fn(c);
      throw new Desfazer();
    });
  } catch (erro) {
    if (!(erro instanceof Desfazer)) throw erro;
  }
}

let equipeId: string;
const contas: string[] = [];
const clientes: string[] = [];

async function conta(papel: string) {
  const [e] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria, papel) values ($1, $2, 'x', false, $3) returning id, token_version`,
    [`Pessoa Mapa ${papel}`, `mapa-${papel}-${randomUUID().slice(0, 8)}@teste.nexaigen.invalid`, papel]
  );
  contas.push(e.id);
  return { id: e.id, cookie: `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId: e.id, nome: `Pessoa ${papel}`, precisaTrocarSenha: false, tokenVersion: e.token_version })}` };
}

beforeAll(async () => {
  equipeId = (await conta("admin")).id;
});

afterAll(async () => {
  await query(`delete from cliente_prefeitura where id = any($1::uuid[])`, [clientes]);
  await query(`delete from equipe_nexaigen where id = any($1::uuid[])`, [contas]);
});

async function novoCliente(c: PoolClient, d: { nome: string; status?: string; pedido?: string }): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, status_contrato, cancelamento_pedido_em, cancelamento_termino_em)
     values ($1, 'PR', 1000, '2026-01-01', $2, $3::date, $3::date + 30) returning id`,
    [d.nome, d.status ?? "ativo", d.pedido ?? null]
  );
  return rows[0].id;
}

/** Código IBGE único nesta execução (o índice único vale entre clientes): base aleatória + sequência. */
const BASE_CODIGO = 4100000 + Math.floor(Math.random() * 90000);
let seqCodigo = 0;
const codigoUnico = () => String(BASE_CODIGO + seqCodigo++);

async function autorizado(c: PoolClient, nome: string, extra: { status?: string; pedido?: string } = {}): Promise<string> {
  const id = await novoCliente(c, { nome, ...extra });
  expect(await definirCodigoIbge(id, codigoUnico(), { lat: -25.4, lon: -49.2 }, c)).toMatchObject({ ok: true });
  expect(await autorizarDivulgacao(id, equipeId, HOJE, c)).toMatchObject({ ok: true });
  return id;
}

const nomesNoMapa = async (c: PoolClient) => (await obterMapaPublico(AGORA, c)).municipios.map((m) => m.nome);

describe.skipIf(!banco)("migration 0013 — Postgres real (banco temporário)", () => {
  it("aplicada 2× sobre o estado pré-0013: ninguém autorizado; CHECK de evento antigo trocado pelo nomeado; requisitos garantidos", async () => {
    await emTransacaoDesfeita(async (c) => {
      await c.query(`alter table cliente_prefeitura drop column codigo_ibge, drop column latitude, drop column longitude, drop column autorizacao_divulgacao, drop column autorizacao_divulgacao_em, drop column autorizacao_divulgacao_por`);
      await c.query(`alter table cliente_evento_contrato drop constraint ck_cliente_evento_contrato_tipo`);
      await c.query(`alter table cliente_evento_contrato add constraint cliente_evento_contrato_tipo_check check (tipo in ('cancelamento_registrado', 'cancelamento_retratado', 'contrato_encerrado'))`);
      const id = await novoCliente(c, { nome: `Antes da 0013 ${sufixo}` });

      await c.query(SQL_0013);
      await c.query(SQL_0013); // idempotente

      const { rows: [linha] } = await c.query<{ autorizacao_divulgacao: boolean }>(`select autorizacao_divulgacao from cliente_prefeitura where id = $1`, [id]);
      expect(linha.autorizacao_divulgacao).toBe(false);
      const { rows: checks } = await c.query<{ conname: string }>(
        `select conname from pg_constraint where conrelid = 'cliente_evento_contrato'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ '\\mtipo\\M'`
      );
      expect(checks.map((r) => r.conname)).toEqual(["ck_cliente_evento_contrato_tipo"]);
      await c.query(`insert into cliente_evento_contrato (cliente_id, tipo, data_evento, origem) values ($1, 'divulgacao_autorizada', current_date, 'painel')`, [id]);
    });
  });

  it("CHECKs: código com 7 dígitos, posição em par e dentro do Brasil, e NÃO dá pra autorizar sem código/posição/data", async () => {
    await emTransacaoDesfeita(async (c) => {
      const id = await novoCliente(c, { nome: `Checks ${sufixo}` });
      const violacao = async (sql: string, constraint: string) => {
        await c.query("savepoint s");
        await expect(c.query(sql, [id])).rejects.toMatchObject({ code: "23514", constraint });
        await c.query("rollback to savepoint s");
      };
      await violacao(`update cliente_prefeitura set codigo_ibge = '41069' where id = $1`, "ck_cliente_prefeitura_codigo_ibge_formato");
      await violacao(`update cliente_prefeitura set latitude = -25 where id = $1`, "ck_cliente_prefeitura_posicao_par");
      await violacao(`update cliente_prefeitura set latitude = 40, longitude = -3 where id = $1`, "ck_cliente_prefeitura_posicao_brasil");
      await violacao(`update cliente_prefeitura set codigo_ibge = '4106902', autorizacao_divulgacao = true, autorizacao_divulgacao_em = now() where id = $1`, "ck_cliente_prefeitura_divulgacao_requisitos");
      await violacao(`update cliente_prefeitura set codigo_ibge = '4106902', latitude = -25, longitude = -49, autorizacao_divulgacao = true where id = $1`, "ck_cliente_prefeitura_divulgacao_requisitos");
    });
  });
});

describe("quem aparece no mapa — Postgres real (transação desfeita)", () => {
  it("sem autorização não; autorizado e ativo sim; encerrado/suspenso não; aviso vigente sim; revogar tira na hora", async () => {
    await emTransacaoDesfeita(async (c) => {
      const semAutorizacao = await novoCliente(c, { nome: `Sem autorização ${sufixo}` });
      await definirCodigoIbge(semAutorizacao, codigoUnico(), { lat: -25, lon: -49 }, c);
      const ativo = await autorizado(c, `Ativo ${sufixo}`);
      const encerrado = await autorizado(c, `Encerrado ${sufixo}`);
      await c.query(`update cliente_prefeitura set status_contrato = 'encerrado' where id = $1`, [encerrado]);
      const suspenso = await autorizado(c, `Suspenso ${sufixo}`);
      await c.query(`update cliente_prefeitura set status_contrato = 'suspenso' where id = $1`, [suspenso]);
      await autorizado(c, `Em aviso ${sufixo}`, { status: "em_aviso_previo", pedido: "2026-11-10" });
      await autorizado(c, `Aviso vencido ${sufixo}`, { status: "em_aviso_previo", pedido: "2026-10-01" }); // término 31/10: já encerrado de fato

      const nomes = (await nomesNoMapa(c)).filter((n) => n.endsWith(sufixo));
      expect(nomes.sort()).toEqual([`Ativo ${sufixo}`, `Em aviso ${sufixo}`]);

      const mapa = await obterMapaPublico(AGORA, c);
      for (const m of mapa.municipios) expect(Object.keys(m).sort()).toEqual(["lat", "lon", "nome", "uf"]);
      expect(Object.keys(mapa).sort()).toEqual(["atualizadoEm", "municipios", "total"]);

      expect(await revogarDivulgacao(ativo, equipeId, HOJE, c)).toMatchObject({ ok: true });
      expect(await nomesNoMapa(c)).not.toContain(`Ativo ${sufixo}`);
      const { rows: [revogado] } = await c.query(`select autorizacao_divulgacao, autorizacao_divulgacao_em, autorizacao_divulgacao_por from cliente_prefeitura where id = $1`, [ativo]);
      expect(revogado).toEqual({ autorizacao_divulgacao: false, autorizacao_divulgacao_em: null, autorizacao_divulgacao_por: null });
    });
  });

  it("autorizar sem posição → 409 do serviço (e o CHECK garante de novo); trocar código autorizado → 409; código duplicado → codigo_em_uso", async () => {
    await emTransacaoDesfeita(async (c) => {
      const pendente = await novoCliente(c, { nome: `Pendente ${sufixo}` });
      const codigo = codigoUnico();
      expect(await definirCodigoIbge(pendente, codigo, null, c)).toMatchObject({ ok: true });
      expect(await autorizarDivulgacao(pendente, equipeId, HOJE, c)).toMatchObject({ ok: false, motivo: "transicao_invalida", erro: expect.stringMatching(/posição/) });

      const outro = await novoCliente(c, { nome: `Outro ${sufixo}` });
      await c.query("savepoint s");
      expect(await definirCodigoIbge(outro, codigo, null, c)).toMatchObject({ ok: false, motivo: "codigo_em_uso" });
      await c.query("rollback to savepoint s");

      const no = await autorizado(c, `Autorizado ${sufixo}`);
      expect(await definirCodigoIbge(no, codigoUnico(), { lat: -20, lon: -45 }, c)).toMatchObject({ ok: false, motivo: "transicao_invalida", erro: expect.stringMatching(/revogue/) });
      expect(await autorizarDivulgacao(no, equipeId, HOJE, c)).toMatchObject({ ok: false, motivo: "transicao_invalida" });
    });
  });

  it("eventos de autorizar/revogar gravados com autor e data; e NÃO atrapalham a lógica de contrato (aviso prévio no relatório)", async () => {
    await emTransacaoDesfeita(async (c) => {
      await c.query(`delete from cliente_prefeitura`); // só dentro desta transação (desfeita no fim): contagem exata
      const id = await autorizado(c, `Eventos ${sufixo}`, { status: "em_aviso_previo", pedido: "2026-11-05" });
      await c.query(`insert into cliente_evento_contrato (cliente_id, tipo, data_evento, origem, criado_em) values ($1, 'cancelamento_registrado', '2026-11-05', 'painel', now() - interval '1 hour')`, [id]);
      await revogarDivulgacao(id, equipeId, HOJE, c);

      const { rows } = await c.query<{ tipo: string; data_evento: string; equipe_id: string; origem: string }>(
        `select tipo, data_evento, equipe_id, origem from cliente_evento_contrato where cliente_id = $1 and tipo like 'divulgacao%' order by criado_em`,
        [id]
      );
      expect(rows).toEqual([
        { tipo: "divulgacao_autorizada", data_evento: HOJE, equipe_id: equipeId, origem: "painel" },
        { tipo: "divulgacao_revogada", data_evento: HOJE, equipe_id: equipeId, origem: "painel" }
      ]);
      // O último evento do cliente é de divulgação — o relatório continua vendo o aviso prévio (só olha eventos de contrato).
      const r = await obterRelatorioContratos("2026-11", AGORA, c);
      expect(r.emAvisoPrevio).toEqual({ quantidade: 1, mrrCentavos: 100000 });
    });
  });
});

describe("rotas reais", () => {
  const IP = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
  let financeiro: { cookie: string };
  let clienteId: string;

  beforeAll(async () => {
    financeiro = await conta("financeiro");
    const [c] = await query<{ id: string }>(
      `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato) values ($1, 'PR', 1000, '2026-01-01') returning id`,
      [`Prefeitura Mapa Rota ${sufixo}`]
    );
    clienteId = c.id;
    clientes.push(c.id);
  });

  afterAll(async () => {
    await query(`delete from rate_limit_contador where chave = $1`, [chaveLimite("mapa-publico:ip", IP)]);
  });

  const put = (cookie: string, corpo: unknown) =>
    DIVULGACAO(new NextRequest(`http://localhost:3001/api/clientes/${clienteId}/divulgacao`, { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(corpo) }), {
      params: Promise.resolve({ id: clienteId })
    });
  const publico = (origem?: string) =>
    MAPA_PUBLICO(new NextRequest("http://localhost:3001/api/publico/mapa-clientes", { headers: { "x-forwarded-for": IP, ...(origem ? { origin: origem } : {}) } }));

  it("vendas e rh: 403 na rota interna", async () => {
    for (const papel of ["vendas", "rh"]) expect((await put((await conta(papel)).cookie, { acao: "autorizar" })).status).toBe(403);
  });

  it("IBGE fora (rede bloqueada nos testes) → grava o código SEM posição; autorizar → 409; com posição → autoriza, aparece no público; revogar → sai", async () => {
    const codigo = `43${String(Date.now()).slice(-5)}`;
    const salvo = await put(financeiro.cookie, { acao: "definir_codigo", codigoIbge: codigo });
    expect(salvo.status).toBe(200);
    expect(await salvo.json()).toEqual({ codigoIbge: codigo, posicao: null, ibge: { status: "indisponivel", ufDoCodigo: "RS" }, confere: false });
    expect((await put(financeiro.cookie, { acao: "autorizar" })).status).toBe(409);

    // Posição chegando depois (equivalente a um "Buscar posição" com o IBGE de volta).
    await query(`update cliente_prefeitura set latitude = -25.4, longitude = -49.2 where id = $1`, [clienteId]);
    expect((await put(financeiro.cookie, { acao: "autorizar" })).status).toBe(200);
    const [linha] = await query<{ autorizacao_divulgacao_por: string; autorizacao_divulgacao_em: string | null }>(`select autorizacao_divulgacao_por, autorizacao_divulgacao_em from cliente_prefeitura where id = $1`, [clienteId]);
    expect(linha.autorizacao_divulgacao_em).not.toBeNull();

    const res = await publico();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=60, max-age=60");
    const corpo = await res.json();
    expect(Object.keys(corpo).sort()).toEqual(["atualizadoEm", "municipios", "total"]);
    expect(corpo.municipios).toContainEqual({ nome: `Prefeitura Mapa Rota ${sufixo}`, uf: "PR", lat: -25.4, lon: -49.2 });
    for (const m of corpo.municipios) expect(Object.keys(m).sort()).toEqual(["lat", "lon", "nome", "uf"]);
    expect(JSON.stringify(corpo)).not.toContain(clienteId);
    expect(JSON.stringify(corpo)).not.toContain(codigo);

    expect((await put(financeiro.cookie, { acao: "revogar" })).status).toBe(200);
    expect((await (await publico()).json()).municipios.map((m: { nome: string }) => m.nome)).not.toContain(`Prefeitura Mapa Rota ${sufixo}`);
  });

  it("CORS: só origem da lista recebe Access-Control-Allow-Origin; vazia = só mesma origem", async () => {
    const original = process.env.MAPA_PUBLICO_ORIGENS;
    try {
      process.env.MAPA_PUBLICO_ORIGENS = "https://www.nexaigen.com.br";
      expect((await publico("https://www.nexaigen.com.br")).headers.get("access-control-allow-origin")).toBe("https://www.nexaigen.com.br");
      expect((await publico("https://outro.example")).headers.get("access-control-allow-origin")).toBeNull();
      process.env.MAPA_PUBLICO_ORIGENS = "";
      expect((await publico("https://www.nexaigen.com.br")).headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      if (original === undefined) delete process.env.MAPA_PUBLICO_ORIGENS;
      else process.env.MAPA_PUBLICO_ORIGENS = original;
    }
  });
});

describe("eventos de divulgação × idempotência da retratação (dados reais, apagados no fim)", () => {
  it("retratar, gravar evento de divulgação, retratar de novo → continua idempotente (mudou: false), nunca 409", async () => {
    const [c] = await query<{ id: string }>(
      `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato) values ($1, 'PR', 1000, '2026-01-01') returning id`,
      [`Prefeitura Retratação ${sufixo}`]
    );
    clientes.push(c.id);
    const autor = { origem: "painel" as const, equipeId };
    const dia = hojeEmSaoPaulo(new Date());
    expect(await registrarCancelamento(c.id, { dataPedido: dia, motivo: "teste" }, autor, dia)).toMatchObject({ ok: true, mudou: true });
    expect(await retratarCancelamento(c.id, autor, dia)).toMatchObject({ ok: true, mudou: true });
    await query(`insert into cliente_evento_contrato (cliente_id, tipo, data_evento, equipe_id, origem) values ($1, 'divulgacao_revogada', $2, $3, 'painel')`, [c.id, dia, equipeId]);
    expect(await retratarCancelamento(c.id, autor, dia)).toMatchObject({ ok: true, mudou: false });
  });
});
