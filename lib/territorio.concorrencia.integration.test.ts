// Concorrência REAL no lote do Território (rodada 16-A3): dois vendedores
// mandam AO MESMO TEMPO "Criar leads para os selecionados" sobre os MESMOS
// municípios — duas requisições, cada uma na sua conexão do pool (transações
// diferentes), 20 rodadas. Em toda rodada:
//   - cada município vira lead UMA vez (nunca dois leads abertos);
//   - as duas respostas são 201/200 (nunca 500): o que uma criou aparece na
//     lista de "pulados" da outra, com o motivo;
//   - os criados das duas não se repetem e, somados, cobrem todos.
// Quem garante: o índice único parcial de lead aberto (0014) + a tradução do
// 23505 em lib/crmServico.ts + o SAVEPOINT por lead em
// lib/territorioServico.ts (desfaz só a tentativa que colidiu, a transação
// do lote continua). Prova de mutação feita removendo o savepoint.
//
// Banco TEMPORÁRIO (testes/bancoTemporario.ts) — só com DATABASE_URL local.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { bancoLocal, criarBancoTemporario, encerrarBancoTemporario, type BancoTemporario } from "@/testes/bancoTemporario";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const LOCAL = bancoLocal();
let banco: BancoTemporario | null = null;
if (LOCAL) {
  banco = await criarBancoTemporario("lote_corrida");
  process.env.DATABASE_URL = banco.url; // ANTES de qualquer import de lib/db
}

const { query } = await import("./db");
const { gerarAccessToken, NOME_COOKIE_ACCESS } = await import("./auth");
const { validarBaseMunicipios } = await import("./baseMunicipios");
const { importarMunicipios } = await import("./municipiosImportacao");
const { liberarEstado } = await import("./entidadesServico");
const rotaLote = await import("@/app/api/territorio/leads/route");

const RODADAS = 20;
const POR_RODADA = 4;
let vera = "";
let beto = "";
let codigos: string[] = [];

async function sessao(nome: string): Promise<{ id: string; cookie: string }> {
  const [e] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria, papel) values ($1, $2, 'x', false, 'vendas') returning id, token_version`,
    [nome, `vendas-${randomUUID().slice(0, 6)}@teste.invalid`]
  );
  return { id: e.id, cookie: `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId: e.id, nome, precisaTrocarSenha: false, tokenVersion: e.token_version })}` };
}

/** Status + corpo; exceção da rota (o que viraria 500) aparece como 500. */
async function lote(cookie: string, alvo: string[]): Promise<{ status: number; corpo: { criados?: { codigo_ibge: string }[]; pulados?: { codigo_ibge: string; motivo: string }[] } }> {
  try {
    const r = await rotaLote.POST(
      new NextRequest("http://localhost:3001/api/territorio/leads", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ acao: "criar", alvo: { modo: "selecao", codigos: alvo } }) })
    );
    return { status: r.status, corpo: await r.json() };
  } catch {
    return { status: 500, corpo: {} };
  }
}

describe.skipIf(!LOCAL)("lote do Território — dois lotes simultâneos (banco temporário)", () => {
  beforeAll(async () => {
    const [{ atual }] = await query<{ atual: string }>(`select current_database() as atual`);
    if (atual !== banco!.nome) throw new Error(`Fora do banco temporário (${atual}) — abortado antes de gravar.`);
    const pr = validarBaseMunicipios(JSON.parse(readFileSync("scripts/dados/municipios-PR.json", "utf-8")), "PR");
    if (!pr.ok) throw new Error(pr.erros.join("\n"));
    await importarMunicipios("PR", pr.municipios);
    const a = await sessao("Vera Vendas");
    const b = await sessao("Beto Vendas");
    vera = a.cookie;
    beto = b.cookie;
    await liberarEstado("PR", true, a.id);
    codigos = pr.municipios.slice(0, RODADAS * POR_RODADA).map((m) => m.codigo_ibge);
  }, 60_000);

  // Ordem (16-A4): fecha o pool da aplicação ANTES do drop — encerrarBancoTemporario faz e confere.
  afterAll(() => encerrarBancoTemporario(banco), 60_000);

  it(`${RODADAS} rodadas: dois lotes ao mesmo tempo sobre os mesmos ${POR_RODADA} municípios — cada um vira lead UMA vez; o perdedor recebe os pulados, nunca 500`, async () => {
    let colisoesNaHora = 0; // pulados descobertos no INSERT (23505 + savepoint), não na leitura
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      const alvo = codigos.slice(rodada * POR_RODADA, (rodada + 1) * POR_RODADA);
      const [r1, r2] = await Promise.all([lote(vera, alvo), lote(beto, alvo)]);
      expect({ rodada, status: [r1.status, r2.status].map((s) => (s === 201 || s === 200 ? "ok" : s)) }).toEqual({ rodada, status: ["ok", "ok"] });

      const criados1 = (r1.corpo.criados ?? []).map((c) => c.codigo_ibge);
      const criados2 = (r2.corpo.criados ?? []).map((c) => c.codigo_ibge);
      expect({ rodada, repetidos: criados1.filter((c) => criados2.includes(c)) }).toEqual({ rodada, repetidos: [] });
      expect({ rodada, todos: [...criados1, ...criados2].sort() }).toEqual({ rodada, todos: [...alvo].sort() });
      // O que um criou está nos pulados do outro, com motivo.
      for (const [criados, outro] of [[criados1, r2], [criados2, r1]] as const) {
        for (const codigo of criados) {
          const pulado = outro.corpo.pulados?.find((p) => p.codigo_ibge === codigo);
          expect({ rodada, codigo, motivo: pulado?.motivo }).toEqual({ rodada, codigo, motivo: expect.stringMatching(/^(já tem lead aberto com|Já existe esse lead: está com) (Vera|Beto) Vendas/) });
          if (pulado!.motivo.startsWith("Já existe esse lead")) colisoesNaHora++;
        }
      }
      const abertos = await query<{ codigo_ibge: string; n: number }>(
        `select codigo_ibge, count(*)::int as n from lead where codigo_ibge = any($1::text[]) and etapa not in ('ganho', 'perdido') group by codigo_ibge`,
        [alvo]
      );
      expect({ rodada, abertos: abertos.map((a) => a.n) }).toEqual({ rodada, abertos: alvo.map(() => 1) });
      const historico = await query<{ n: number }>(`select count(*)::int as n from lead_interacao i join lead l on l.id = i.lead_id where l.codigo_ibge = any($1::text[]) and i.tipo = 'criacao'`, [alvo]);
      expect({ rodada, historico: historico[0].n }).toEqual({ rodada, historico: POR_RODADA }); // a tentativa desfeita não deixa histórico
    }
    console.log(`[lote concorrente] colisões descobertas no INSERT (caminho do savepoint): ${colisoesNaHora} em ${RODADAS} rodadas`);
    expect(colisoesNaHora).toBeGreaterThan(0); // o teste exercita de fato o caminho do savepoint, não só a leitura
  }, 180_000);
});
