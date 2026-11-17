// Testes unitários de PATCH /api/clientes/[id] — só atualiza os campos
// enviados, nunca aceita colunas fora do schema (municipio_id_externo,
// contrato_arquivo_*). @/lib/db mockado, sessão real.

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "chave-de-teste-jwt-apenas-unitario";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: queryMock }));

import { NextRequest } from "next/server";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { PATCH } from "./route";

const CLIENTE_ID = "0b6c5c0e-2f7d-4d8e-9a1b-3c4d5e6f7a8b";

async function patch(corpo: unknown, id = CLIENTE_ID) {
  const token = await gerarAccessToken({ equipeId: "equipe-1", nome: "Teste", precisaTrocarSenha: false, tokenVersion: 1 });
  return PATCH(
    new NextRequest(`http://localhost:3001/api/clientes/${id}`, {
      method: "PATCH",
      headers: { cookie: `${NOME_COOKIE_ACCESS}=${token}`, "content-type": "application/json" },
      body: JSON.stringify(corpo)
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("from equipe_nexaigen")) return [{ token_version: 1, ativo: true, papel: "admin" }];
    if (sql.includes("update cliente_prefeitura")) return [{ id: CLIENTE_ID }];
    throw new Error(`SQL não esperada: ${sql}`);
  });
});

function chamadaUpdate() {
  return queryMock.mock.calls.find((c: unknown[]) => (c[0] as string).includes("update cliente_prefeitura"));
}

describe("PATCH /api/clientes/[id]", () => {
  it("atualiza SÓ os campos enviados (sem reaplicar defaults de plano/dia/taxa) — dinheiro como TEXTO → numeric exato", async () => {
    const res = await patch({ observacao: "Contrato renovado", valor_mensal: "5000,10" });
    expect(res.status).toBe(200);
    const [sql, params] = chamadaUpdate()!;
    expect(sql).toContain("set valor_mensal = $1, observacao = $2 where id = $3");
    expect(sql).not.toContain("plano");
    expect(sql).not.toContain("taxa_implantacao");
    expect(params).toEqual(["5000.10", "Contrato renovado", CLIENTE_ID]);
  });

  it("trocar plano NÃO reprecifica sozinho: só o plano vai pro UPDATE (a tela manda os valores novos explicitamente)", async () => {
    await patch({ plano: "grande_porte" });
    const [sql, params] = chamadaUpdate()!;
    expect(sql).toContain("set plano = $1 where id = $2");
    expect(params).toEqual(["grande_porte", CLIENTE_ID]);
  });

  it("taxa null explícita limpa a taxa; taxa em texto vira numeric", async () => {
    await patch({ taxa_implantacao: null });
    expect(chamadaUpdate()![1]).toEqual([null, CLIENTE_ID]);
    queryMock.mockClear();
    await patch({ taxa_implantacao: "18000" });
    expect(chamadaUpdate()![1]).toEqual(["18000.00", CLIENTE_ID]);
  });

  it("CHECK Dispensa-sem-taxa do banco (ex.: taxa num cliente Dispensa) vira 400 explicando, nunca 500", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("from equipe_nexaigen")) return [{ token_version: 1, ativo: true, papel: "admin" }];
      throw Object.assign(new Error("check"), { code: "23514", constraint: "ck_cliente_prefeitura_dispensa_sem_taxa" });
    });
    const res = await patch({ taxa_implantacao: "100" });
    expect(res.status).toBe(400);
    expect((await res.json()).detalhes.formErrors[0]).toMatch(/Dispensa não tem taxa/);
  });

  it("observacao vazia limpa o campo (null)", async () => {
    await patch({ observacao: "" });
    expect(chamadaUpdate()![1]).toEqual([null, CLIENTE_ID]);
  });

  it.each([
    ["corpo vazio", {}],
    ["coluna fora do schema (municipio_id_externo)", { municipio_id_externo: "6f1c2b0e-5a4d-4c3b-9e8f-1a2b3c4d5e6f" }],
    ["coluna fora do schema (contrato_arquivo_chave)", { contrato_arquivo_chave: "qualquer/coisa.pdf" }],
    ["valor inválido", { valor_mensal: "-10" }],
    ["valor como number (float) — dinheiro só como texto", { valor_mensal: 5000.5 }],
    ["plano descontinuado", { plano: "essencial" }],
    ["Dispensa com taxa no mesmo PATCH", { plano: "dispensa", taxa_implantacao: "100" }]
  ])("%s — 400, nunca chega ao UPDATE", async (_d, corpo) => {
    const res = await patch(corpo);
    expect(res.status).toBe(400);
    expect(chamadaUpdate()).toBeUndefined();
  });

  it("id que não é uuid — 404 sem chegar ao banco", async () => {
    const res = await patch({ observacao: "x" }, "nao-uuid");
    expect(res.status).toBe(404);
    expect(chamadaUpdate()).toBeUndefined();
  });
});
