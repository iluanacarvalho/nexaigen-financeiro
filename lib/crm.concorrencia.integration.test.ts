// Concorrência REAL no CRM (rodada 16-A1): duas requisições AO MESMO TEMPO,
// pelas rotas reais, cada uma na sua conexão do pool (transações
// diferentes), pro MESMO município:
//   - criar com o mesmo código IBGE;
//   - criar com o mesmo nome + UF (sem código, variando acento/caixa);
//   - reabrir dois leads PERDIDOS do mesmo município.
// Em toda rodada: exatamente uma passa e a outra recebe a resposta de
// duplicidade (409) — nunca 500, nunca as duas. Quando as duas passam pela
// checagem prévia ao mesmo tempo, quem barra é o índice único parcial da
// 0014 (erro 23505), traduzido em 409 por lib/crmServico.ts — sem esse
// tratamento a rota estoura (500): prova de mutação feita removendo-o.
//
// Banco TEMPORÁRIO (testes/bancoTemporario.ts) — só com DATABASE_URL local.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { bancoLocal, criarBancoTemporario, encerrarBancoTemporario, type BancoTemporario } from "@/testes/bancoTemporario";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const LOCAL = bancoLocal();
let banco: BancoTemporario | null = null;
if (LOCAL) {
  banco = await criarBancoTemporario("crm_corrida");
  process.env.DATABASE_URL = banco.url; // ANTES de qualquer import de lib/db
}

const { query } = await import("./db");
const { gerarAccessToken, NOME_COOKIE_ACCESS } = await import("./auth");
const rotaLeads = await import("@/app/api/leads/route");
const rotaEtapa = await import("@/app/api/leads/[id]/etapa/route");

const RODADAS = 20;
let cookieA = "";
let cookieB = "";
let cookieAdmin = "";

async function sessao(papel: string, nome: string): Promise<string> {
  const [e] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria, papel) values ($1, $2, 'x', false, $3) returning id, token_version`,
    [nome, `${papel}-${randomUUID().slice(0, 6)}@teste.invalid`, papel]
  );
  return `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId: e.id, nome, precisaTrocarSenha: false, tokenVersion: e.token_version })}`;
}

const criar = (cookie: string, corpo: Record<string, unknown>) =>
  rotaLeads.POST(new NextRequest("http://localhost:3001/api/leads", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ origem: "site", uf: "PR", ...corpo }) }));

/** Status + corpo; uma exceção da rota (o que viraria 500) aparece como 500 aqui. */
async function resultado(resposta: Promise<Response>): Promise<{ status: number; corpo: { erro?: string; id?: string } }> {
  try {
    const r = await resposta;
    return { status: r.status, corpo: await r.json() };
  } catch {
    return { status: 500, corpo: {} };
  }
}

describe.skipIf(!LOCAL)("CRM — concorrência real (banco temporário)", () => {
  beforeAll(async () => {
    const [{ atual }] = await query<{ atual: string }>(`select current_database() as atual`);
    if (atual !== banco!.nome) throw new Error(`Fora do banco temporário (${atual}) — abortado antes de gravar.`);
    cookieA = await sessao("vendas", "Vera Vendas");
    cookieB = await sessao("vendas", "Beto Vendas");
    cookieAdmin = await sessao("admin", "Ana Admin");
  });

  // Ordem (16-A4): fecha o pool da aplicação ANTES do drop — encerrarBancoTemporario faz e confere.
  afterAll(() => encerrarBancoTemporario(banco), 60_000);

  it(`${RODADAS} rodadas: dois vendedores criam o MESMO código IBGE ao mesmo tempo — um 201, o outro 409 (nunca 500)`, async () => {
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      const codigo = String(4100000 + rodada);
      const respostas = await Promise.all([
        resultado(criar(cookieA, { municipio_nome: `Código A ${rodada}`, codigo_ibge: codigo })),
        resultado(criar(cookieB, { municipio_nome: `Código B ${rodada}`, codigo_ibge: codigo }))
      ]);
      expect({ rodada, status: respostas.map((r) => r.status).sort() }).toEqual({ rodada, status: [201, 409] });
      expect(respostas.find((r) => r.status === 409)!.corpo.erro).toMatch(/^Já existe esse lead: está com (Vera|Beto) Vendas, etapa Novo\.$/);
      const [{ n }] = await query<{ n: number }>(`select count(*)::int as n from lead where codigo_ibge = $1`, [codigo]);
      expect({ rodada, leads: n }).toEqual({ rodada, leads: 1 });
    }
  }, 120_000);

  it(`${RODADAS} rodadas: mesmo nome + UF sem código (variando acento/caixa) ao mesmo tempo — um 201, o outro 409`, async () => {
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      const respostas = await Promise.all([
        resultado(criar(cookieA, { municipio_nome: `São Corrida ${rodada}` })),
        resultado(criar(cookieB, { municipio_nome: `SAO CORRIDA ${rodada}` }))
      ]);
      expect({ rodada, status: respostas.map((r) => r.status).sort() }).toEqual({ rodada, status: [201, 409] });
      const [{ n }] = await query<{ n: number }>(`select count(*)::int as n from lead where nome_busca = $1`, [`sao corrida ${rodada}`]);
      expect({ rodada, leads: n }).toEqual({ rodada, leads: 1 });
    }
  }, 120_000);

  it(`${RODADAS} rodadas: reabrir AO MESMO TEMPO dois leads perdidos do mesmo município — um reabre, o outro 409`, async () => {
    const reabrir = (id: string) =>
      rotaEtapa.POST(
        new NextRequest(`http://localhost:3001/api/leads/${id}/etapa`, { method: "POST", headers: { cookie: cookieAdmin, "content-type": "application/json" }, body: JSON.stringify({ acao: "reabrir" }) }),
        { params: Promise.resolve({ id }) }
      );
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      // Dois leads perdidos do mesmo município (permitido: o índice único só vale pra lead ABERTO).
      const ids: string[] = [];
      for (const cookie of [cookieA, cookieB]) {
        const r = await resultado(criar(cookie, { municipio_nome: `Reabre ${rodada}` }));
        expect(r.status).toBe(201);
        ids.push(r.corpo.id!);
        await query(`update lead set etapa = 'perdido', motivo_perda = 'sem_resposta' where id = $1`, [r.corpo.id]);
      }
      const respostas = await Promise.all(ids.map((id) => resultado(reabrir(id))));
      expect({ rodada, status: respostas.map((r) => r.status).sort() }).toEqual({ rodada, status: [200, 409] });
      const abertos = await query(`select 1 from lead where nome_busca = $1 and etapa not in ('ganho', 'perdido')`, [`reabre ${rodada}`]);
      expect({ rodada, abertos: abertos.length }).toEqual({ rodada, abertos: 1 });
    }
  }, 120_000);
});
