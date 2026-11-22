// Concorrência REAL nas tarefas (rodada 16-B1): duas pessoas de Contratos
// clicam "Assumir" AO MESMO TEMPO na MESMA tarefa — duas requisições, cada
// uma na sua conexão do pool (transações diferentes), 20 rodadas. Em toda
// rodada: exatamente UMA assume (200), a outra recebe 409 "já foi assumida
// por …" — nunca 500, nunca as duas; o banco tem um responsável e UMA linha
// 'assumida' no histórico. Quem garante: o `select … for update` da tarefa
// em lib/tarefasServico.ts#agirNaTarefa (a segunda espera a primeira e vê
// a tarefa já em andamento).
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
  banco = await criarBancoTemporario("tarefa_corrida");
  process.env.DATABASE_URL = banco.url; // ANTES de qualquer import de lib/db
}

const { query } = await import("./db");
const { gerarAccessToken, NOME_COOKIE_ACCESS } = await import("./auth");
const rotaTarefa = await import("@/app/api/operacao/tarefas/[id]/route");

const RODADAS = 20;
const pessoas: { id: string; nome: string; cookie: string }[] = [];

async function pessoa(nome: string) {
  const [e] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria, papel) values ($1, $2, 'x', false, 'contratos') returning id, token_version`,
    [nome, `contratos-${randomUUID().slice(0, 6)}@teste.invalid`]
  );
  return { id: e.id, nome, cookie: `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId: e.id, nome, precisaTrocarSenha: false, tokenVersion: e.token_version })}` };
}

async function assumir(cookie: string, id: string): Promise<{ status: number; erro?: string }> {
  try {
    const r = await rotaTarefa.POST(new NextRequest(`http://localhost:3001/api/operacao/tarefas/${id}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ acao: "assumir" }) }), { params: Promise.resolve({ id }) });
    return { status: r.status, erro: (await r.json()).erro };
  } catch {
    return { status: 500 };
  }
}

describe.skipIf(!LOCAL)("tarefas — duas pessoas assumindo a mesma tarefa ao mesmo tempo (banco temporário)", () => {
  beforeAll(async () => {
    const [{ atual }] = await query<{ atual: string }>(`select current_database() as atual`);
    if (atual !== banco!.nome) throw new Error(`Fora do banco temporário (${atual}) — abortado antes de gravar.`);
    pessoas.push(await pessoa("Carla Contratos"), await pessoa("Caio Contratos"));
  }, 60_000);

  afterAll(() => encerrarBancoTemporario(banco), 60_000);

  it(`${RODADAS} rodadas: uma pessoa assume (200), a outra recebe 409 — nunca 500, nunca as duas`, async () => {
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      const [{ id: cliente }] = await query<{ id: string }>(
        `insert into cliente_prefeitura (nome, uf, valor_mensal, status_contrato, data_inicio_contrato) values ($1, 'PR', 1000, 'aguardando_assinatura', null) returning id`,
        [`Prefeitura Corrida ${rodada}`]
      );
      const [{ id: tarefa }] = await query<{ id: string }>(`insert into tarefa_operacional (tipo, cliente_id, papel_responsavel, prazo) values ('contrato_assinatura', $1, 'contratos', current_date + 5) returning id`, [cliente]);
      const respostas = await Promise.all(pessoas.map((p) => assumir(p.cookie, tarefa)));
      expect({ rodada, status: respostas.map((r) => r.status).sort() }).toEqual({ rodada, status: [200, 409] });
      const vencedora = pessoas[respostas.findIndex((r) => r.status === 200)];
      const perdedora = respostas.find((r) => r.status === 409)!;
      expect({ rodada, erro: perdedora.erro }).toEqual({ rodada, erro: `Esta tarefa já foi assumida por ${vencedora.nome}.` });
      expect(await query(`select status, responsavel_id from tarefa_operacional where id = $1`, [tarefa])).toEqual([{ status: "em_andamento", responsavel_id: vencedora.id }]);
      const historico = await query<{ n: number }>(`select count(*)::int as n from tarefa_historico where tarefa_id = $1 and acao = 'assumida'`, [tarefa]);
      expect({ rodada, assumidas: historico[0]?.n ?? 0 }).toEqual({ rodada, assumidas: 1 });
    }
  }, 180_000);
});
