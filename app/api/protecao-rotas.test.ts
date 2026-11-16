// TESTE MAIS IMPORTANTE do projeto (achado crítico de segurança):
// confirma que TODA rota de API que estava completamente aberta antes da
// rodada de login agora devolve 401 sem sessão — e nunca sequer chega a
// tocar o banco (`query` mockada pra LANÇAR se for chamada, provando que
// exigirSessao() barra ANTES de qualquer consulta, não só que a resposta
// final aparenta estar certa). Também confirma que
// /api/cron/verificar-prazos continua funcionando SÓ com CRON_SECRET,
// sem exigir sessão nenhuma (é chamada por um agendador externo, não por
// uma pessoa logada).
//
// RODADA DE MIGRAÇÃO DE INFRAESTRUTURA: mocka @/lib/db (`query`) em vez
// de @/lib/supabase/server (`supabaseAdmin`) — mesma garantia de antes,
// só o alvo do mock muda.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(() => {
    throw new Error("query() NUNCA deveria ser chamada sem sessão válida.");
  })
}));
vi.mock("@/lib/db", () => ({ query: queryMock, withTransaction: queryMock }));

// Cron continua com seu próprio mock de notificação (mesmo padrão do
// teste dedicado daquela rota) — não é o alvo deste arquivo, só precisa
// não quebrar a importação.
vi.mock("@/lib/notificacao-interna", () => ({ notificarTimeDeCobranca: vi.fn() }));
vi.mock("@/lib/notificacaoCliente", () => ({ notificarClientePrefeitura: vi.fn() }));
// A rota de integração alerta falha de banco via alertarErroSistema (que
// usa query() internamente) — mockado pra não poluir o sinal do queryMock.
vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));
// Rate limit (rodada 07) também usa o banco — permissivo aqui, pra que o
// sinal "query() nunca é chamada antes da autorização" continue medindo só
// o acesso a DADOS das rotas. Os limites em si têm testes próprios.
vi.mock("@/lib/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rateLimit")>()),
  registrarTentativa: vi.fn(async () => ({ permitido: true, contagem: 1, retryAfterSegundos: 60 })),
  desfazerTentativa: vi.fn(async () => undefined)
}));

import { NextRequest } from "next/server";
import { GET as clientesGet, POST as clientesPost } from "./clientes/route";
import { GET as notasGet, POST as notasPost } from "./notas/route";
import { POST as verificarPost } from "./notas/[id]/verificar/route";
import { GET as arquivoGet, POST as arquivoPost } from "./notas/[id]/arquivo/route";
import { GET as versoesGet } from "./notas/[id]/arquivo/versoes/route";
import { POST as acoesNotaPost } from "./notas/[id]/acoes/route";
import { GET as eventosNotaGet } from "./notas/[id]/eventos/route";
import { GET as versoesContratoGet } from "./clientes/[id]/contrato/versoes/route";
import { GET as alertasGet } from "./alertas/route";
import { GET as equipeGet, POST as equipePost } from "./equipe/route";
import { POST as cronPost } from "./cron/verificar-prazos/route";
import { GET as clienteGet, PATCH as clientePatch } from "./clientes/[id]/route";
import { GET as contratoGet, POST as contratoPost } from "./clientes/[id]/contrato/route";
import { POST as integracaoPost } from "./integracao/clientes/route";
import { GET as painelGet } from "./painel-financeiro/route";
import { GET as configuracaoStatusGet } from "./configuracao/status/route";
import { DELETE as cancelamentoDelete, POST as cancelamentoPost } from "./clientes/[id]/cancelamento/route";
import { POST as integracaoCancelamentoPost } from "./integracao/clientes/[municipioIdExterno]/cancelamento/route";

function reqSemSessao(url: string, method: string): NextRequest {
  return new NextRequest(`http://localhost:3001${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : "{}"
  });
}

beforeEach(() => {
  queryMock.mockClear();
});

describe("achado crítico de segurança — toda rota antes aberta agora exige sessão (401 sem cookie)", () => {
  it.each([
    ["GET /api/clientes", () => clientesGet(reqSemSessao("/api/clientes", "GET"))],
    ["POST /api/clientes", () => clientesPost(reqSemSessao("/api/clientes", "POST"))],
    ["GET /api/notas", () => notasGet(reqSemSessao("/api/notas", "GET"))],
    ["GET /api/notas?situacao=paga&pagina=2", () => notasGet(reqSemSessao("/api/notas?situacao=paga&pagina=2", "GET"))],
    ["POST /api/notas", () => notasPost(reqSemSessao("/api/notas", "POST"))],
    ["POST /api/notas/[id]/verificar", () => verificarPost(reqSemSessao("/api/notas/nota-1/verificar", "POST"), { params: Promise.resolve({ id: "nota-1" }) })],
    ["POST /api/notas/[id]/arquivo", () => arquivoPost(reqSemSessao("/api/notas/nota-1/arquivo", "POST"), { params: Promise.resolve({ id: "nota-1" }) })],
    ["GET /api/notas/[id]/arquivo", () => arquivoGet(reqSemSessao("/api/notas/nota-1/arquivo", "GET"), { params: Promise.resolve({ id: "nota-1" }) })],
    ["GET /api/notas/[id]/arquivo?versao=1", () => arquivoGet(reqSemSessao("/api/notas/nota-1/arquivo?versao=1", "GET"), { params: Promise.resolve({ id: "nota-1" }) })],
    ["GET /api/notas/[id]/arquivo/versoes", () => versoesGet(reqSemSessao("/api/notas/nota-1/arquivo/versoes", "GET"), { params: Promise.resolve({ id: "nota-1" }) })],
    ["POST /api/notas/[id]/acoes", () => acoesNotaPost(reqSemSessao("/api/notas/nota-1/acoes", "POST"), { params: Promise.resolve({ id: "nota-1" }) })],
    ["GET /api/notas/[id]/eventos", () => eventosNotaGet(reqSemSessao("/api/notas/nota-1/eventos", "GET"), { params: Promise.resolve({ id: "nota-1" }) })],
    ["GET /api/clientes/[id]/contrato/versoes", () => versoesContratoGet(reqSemSessao("/api/clientes/cliente-1/contrato/versoes", "GET"), { params: Promise.resolve({ id: "cliente-1" }) })],
    ["GET /api/clientes/[id]/contrato?versao=1", () => contratoGet(reqSemSessao("/api/clientes/cliente-1/contrato?versao=1", "GET"), { params: Promise.resolve({ id: "cliente-1" }) })],
    ["GET /api/clientes/[id]", () => clienteGet(reqSemSessao("/api/clientes/cliente-1", "GET"), { params: Promise.resolve({ id: "cliente-1" }) })],
    ["PATCH /api/clientes/[id]", () => clientePatch(reqSemSessao("/api/clientes/cliente-1", "PATCH"), { params: Promise.resolve({ id: "cliente-1" }) })],
    ["POST /api/clientes/[id]/contrato", () => contratoPost(reqSemSessao("/api/clientes/cliente-1/contrato", "POST"), { params: Promise.resolve({ id: "cliente-1" }) })],
    ["GET /api/clientes/[id]/contrato", () => contratoGet(reqSemSessao("/api/clientes/cliente-1/contrato", "GET"), { params: Promise.resolve({ id: "cliente-1" }) })],
    ["GET /api/alertas", () => alertasGet(reqSemSessao("/api/alertas", "GET"))],
    ["GET /api/painel-financeiro", () => painelGet(reqSemSessao("/api/painel-financeiro", "GET"))],
    ["GET /api/configuracao/status", () => configuracaoStatusGet(reqSemSessao("/api/configuracao/status", "GET"))],
    ["GET /api/painel-financeiro?formato=csv", () => painelGet(reqSemSessao("/api/painel-financeiro?formato=csv", "GET"))],
    ["GET /api/equipe", () => equipeGet(reqSemSessao("/api/equipe", "GET"))],
    ["POST /api/clientes/[id]/cancelamento", () => cancelamentoPost(reqSemSessao("/api/clientes/cliente-1/cancelamento", "POST"), { params: Promise.resolve({ id: "cliente-1" }) })],
    ["DELETE /api/clientes/[id]/cancelamento", () => cancelamentoDelete(reqSemSessao("/api/clientes/cliente-1/cancelamento", "DELETE"), { params: Promise.resolve({ id: "cliente-1" }) })],
    ["POST /api/equipe", () => equipePost(reqSemSessao("/api/equipe", "POST"))]
  ])("%s — 401, nunca chama query()", async (_descricao, chamar) => {
    const res = await chamar();
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("/api/cron/verificar-prazos — NÃO afetado por esta rodada (segredo externo, não sessão de equipe)", () => {
  const CRON_SECRET_ORIGINAL = process.env.CRON_SECRET;
  const SEGREDO = "segredo-de-teste-cron";

  beforeEach(() => {
    process.env.CRON_SECRET = SEGREDO;
  });

  afterAll(() => {
    if (CRON_SECRET_ORIGINAL === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = CRON_SECRET_ORIGINAL;
  });

  it("sem CRON_SECRET no header — 401 (comportamento já existente, não uma regressão desta rodada)", async () => {
    const res = await cronPost(new NextRequest("http://localhost:3001/api/cron/verificar-prazos", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("com Authorization: Bearer CRON_SECRET — passa direto da checagem de autorização pro banco, SEM PRECISAR de sessão de equipe nenhuma", async () => {
    // `query` mockada pra LANÇAR (ver topo do arquivo) — usado aqui como
    // sinal: se a chamada chega a invocar query(), é porque passou pela
    // única barreira de autorização desta rota (CRON_SECRET) sem passar
    // por exigirSessao()/obterContextoAutenticado() em nenhum momento —
    // uma rota que exigisse sessão de equipe teria devolvido um 401 "Não
    // autenticado" (resposta normal, sem exceção) muito antes de
    // qualquer chamada ao banco.
    await expect(
      cronPost(
        new NextRequest("http://localhost:3001/api/cron/verificar-prazos", {
          method: "POST",
          headers: { Authorization: `Bearer ${SEGREDO}` }
        })
      )
    ).rejects.toThrow("query() NUNCA deveria ser chamada sem sessão válida.");
    expect(queryMock).toHaveBeenCalled();
  });
});

describe("/api/integracao/clientes — segredo compartilhado com o nexaigen-educa (INTEGRACAO_SECRET), nunca sessão de equipe", () => {
  const ORIGINAL = process.env.INTEGRACAO_SECRET;
  const SEGREDO = "segredo-de-teste-integracao";
  const corpo = JSON.stringify({
    municipioIdExterno: "6f1c2b0e-5a4d-4c3b-9e8f-1a2b3c4d5e6f",
    nome: "Prefeitura Teste",
    uf: "PR",
    valorMensal: 1000,
    dataInicioContrato: "2026-10-01"
  });

  beforeEach(() => {
    process.env.INTEGRACAO_SECRET = SEGREDO;
  });

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.INTEGRACAO_SECRET;
    else process.env.INTEGRACAO_SECRET = ORIGINAL;
  });

  it("sem Authorization — 401, nunca chama query()", async () => {
    const res = await integracaoPost(new NextRequest("http://localhost:3001/api/integracao/clientes", { method: "POST", body: corpo }));
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("um cookie de sessão de equipe NÃO substitui o segredo — 401, nunca chama query()", async () => {
    const res = await integracaoPost(
      new NextRequest("http://localhost:3001/api/integracao/clientes", {
        method: "POST",
        headers: { cookie: "access_token=qualquer-coisa" },
        body: corpo
      })
    );
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("com Authorization: Bearer INTEGRACAO_SECRET — chega ao banco SEM precisar de sessão de equipe", async () => {
    // Mesmo sinal usado no teste do cron acima: query() mockada pra lançar
    // prova que a única barreira atravessada foi o segredo. A rota captura
    // a exceção (500 + alerta de sistema), então o sinal aqui é o próprio
    // queryMock ter sido chamado.
    const res = await integracaoPost(
      new NextRequest("http://localhost:3001/api/integracao/clientes", {
        method: "POST",
        headers: { authorization: `Bearer ${SEGREDO}`, "content-type": "application/json" },
        body: corpo
      })
    );
    expect(queryMock).toHaveBeenCalled();
    expect(res.status).toBe(500);
  });
});

describe("/api/integracao/clientes/[municipioIdExterno]/cancelamento — mesmo segredo da integração (INTEGRACAO_SECRET), nunca sessão de equipe", () => {
  const ORIGINAL = process.env.INTEGRACAO_SECRET;
  const SEGREDO = "segredo-de-teste-integracao-cancelamento";
  const MUNICIPIO = "6f1c2b0e-5a4d-4c3b-9e8f-1a2b3c4d5e6f";
  const url = `http://localhost:3001/api/integracao/clientes/${MUNICIPIO}/cancelamento`;
  const corpo = JSON.stringify({ acao: "registrar", dataPedido: "2026-10-01" });
  const ctx = { params: Promise.resolve({ municipioIdExterno: MUNICIPIO }) };

  beforeEach(() => {
    process.env.INTEGRACAO_SECRET = SEGREDO;
  });

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.INTEGRACAO_SECRET;
    else process.env.INTEGRACAO_SECRET = ORIGINAL;
  });

  it("sem Authorization — 401, nunca chama query()", async () => {
    const res = await integracaoCancelamentoPost(new NextRequest(url, { method: "POST", body: corpo }), ctx);
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("segredo errado ou só cookie de sessão — 401, nunca chama query()", async () => {
    for (const headers of [{ authorization: "Bearer outro-segredo" }, { cookie: "access_token=qualquer-coisa" }] as Record<string, string>[]) {
      const res = await integracaoCancelamentoPost(new NextRequest(url, { method: "POST", headers, body: corpo }), ctx);
      expect(res.status).toBe(401);
    }
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("com Authorization: Bearer INTEGRACAO_SECRET — chega ao banco SEM sessão de equipe", async () => {
    // query() mockada pra lançar: a rota captura (500 + alerta de sistema) — o sinal é o banco ter sido alcançado.
    const res = await integracaoCancelamentoPost(
      new NextRequest(url, { method: "POST", headers: { authorization: `Bearer ${SEGREDO}`, "content-type": "application/json" }, body: corpo }),
      ctx
    );
    expect(queryMock).toHaveBeenCalled();
    expect(res.status).toBe(500);
  });
});
