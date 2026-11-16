// lib/cancelamentoServico.ts#encerrarAvisosVencidos — ISOLAMENTO DE ERRO
// por cliente: a falha ao encerrar um contrato não impede os outros (cada
// um na sua transação). Banco mockado; o fluxo real contra Postgres está
// em app/api/clientes/[id]/cancelamento/route.integration.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@/lib/db", () => ({
  query: queryMock,
  // Executor falso: as queries "dentro" da transação passam pelo mesmo mock.
  withTransaction: vi.fn(async (fn: (c: object) => Promise<unknown>) => fn({}))
}));

import { encerrarAvisosVencidos } from "./cancelamentoServico";

beforeEach(() => {
  queryMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("encerrarAvisosVencidos", () => {
  it("falha num cliente → os outros ainda são encerrados; contagens no resumo; erro cru nunca logado", async () => {
    queryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("cancelamento_termino_em < $1::date")) return [{ id: "a" }, { id: "b" }, { id: "c" }];
      if (sql.includes("for update")) {
        if (params[0] === "a") throw Object.assign(new Error("dado sensível da linha"), { code: "40P01" });
        return [{ id: params[0], status_contrato: "em_aviso_previo", data_inicio_contrato: "2026-01-01", cancelamento_pedido_em: "2026-09-01", cancelamento_termino_em: "2026-10-01" }];
      }
      return [];
    });

    expect(await encerrarAvisosVencidos("2026-10-02")).toEqual({ encerrados: 2, falhas: 1 });

    const encerrou = queryMock.mock.calls.filter(([sql]) => (sql as string).includes("set status_contrato = 'encerrado'")).map(([, p]) => (p as unknown[])[0]);
    expect(encerrou).toEqual(["b", "c"]);
    const eventos = queryMock.mock.calls.filter(([sql]) => (sql as string).includes("insert into cliente_evento_contrato")).map(([, p]) => p as unknown[]);
    // [cliente, tipo, data_evento (= término), detalhe, equipe_id, origem]
    expect(eventos.map((p) => [p[0], p[1], p[2], p[4], p[5]])).toEqual([
      ["b", "contrato_encerrado", "2026-10-01", null, "sistema"],
      ["c", "contrato_encerrado", "2026-10-01", null, "sistema"]
    ]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("dado sensível");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("40P01");
  });

  it("nenhum vencido → nada a fazer", async () => {
    queryMock.mockResolvedValue([]);
    expect(await encerrarAvisosVencidos("2026-10-02")).toEqual({ encerrados: 0, falhas: 0 });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
