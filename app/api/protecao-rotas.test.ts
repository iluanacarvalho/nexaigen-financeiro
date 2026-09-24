// TESTE MAIS IMPORTANTE desta rodada (achado crítico de segurança):
// confirma que TODA rota de API que estava completamente aberta antes
// desta rodada agora devolve 401 sem sessão — e nunca sequer chega a
// tocar o banco (supabaseAdmin mockado pra LANÇAR se for chamado,
// provando que exigirSessao() barra ANTES de qualquer consulta, não só
// que a resposta final aparenta estar certa). Também confirma que
// /api/cron/verificar-prazos continua funcionando SÓ com CRON_SECRET,
// sem exigir sessão nenhuma (é chamada por um agendador externo, não por
// uma pessoa logada).

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseAdminMock } = vi.hoisted(() => ({
  supabaseAdminMock: vi.fn(() => {
    throw new Error("supabaseAdmin() NUNCA deveria ser chamado sem sessão válida.");
  })
}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: supabaseAdminMock }));

// Cron continua com seu próprio mock de notificação (mesmo padrão do
// teste dedicado daquela rota) — não é o alvo deste arquivo, só precisa
// não quebrar a importação.
vi.mock("@/lib/notificacao-interna", () => ({ notificarTimeDeCobranca: vi.fn() }));
vi.mock("@/lib/notificacaoCliente", () => ({ notificarClientePrefeitura: vi.fn() }));

import { NextRequest } from "next/server";
import { GET as clientesGet, POST as clientesPost } from "./clientes/route";
import { GET as notasGet, POST as notasPost } from "./notas/route";
import { POST as verificarPost } from "./notas/[id]/verificar/route";
import { GET as alertasGet } from "./alertas/route";
import { GET as equipeGet, POST as equipePost } from "./equipe/route";
import { POST as cronPost } from "./cron/verificar-prazos/route";

function reqSemSessao(url: string, method: string): NextRequest {
  return new NextRequest(`http://localhost:3001${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : "{}"
  });
}

beforeEach(() => {
  supabaseAdminMock.mockClear();
});

describe("achado crítico de segurança — toda rota antes aberta agora exige sessão (401 sem cookie)", () => {
  it.each([
    ["GET /api/clientes", () => clientesGet(reqSemSessao("/api/clientes", "GET"))],
    ["POST /api/clientes", () => clientesPost(reqSemSessao("/api/clientes", "POST"))],
    ["GET /api/notas", () => notasGet(reqSemSessao("/api/notas", "GET"))],
    ["POST /api/notas", () => notasPost(reqSemSessao("/api/notas", "POST"))],
    ["POST /api/notas/[id]/verificar", () => verificarPost(reqSemSessao("/api/notas/nota-1/verificar", "POST"), { params: Promise.resolve({ id: "nota-1" }) })],
    ["GET /api/alertas", () => alertasGet(reqSemSessao("/api/alertas", "GET"))],
    ["GET /api/equipe", () => equipeGet(reqSemSessao("/api/equipe", "GET"))],
    ["POST /api/equipe", () => equipePost(reqSemSessao("/api/equipe", "POST"))]
  ])("%s — 401, nunca chama supabaseAdmin()", async (_descricao, chamar) => {
    const res = await chamar();
    expect(res.status).toBe(401);
    expect(supabaseAdminMock).not.toHaveBeenCalled();
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
    expect(supabaseAdminMock).not.toHaveBeenCalled();
  });

  it("com Authorization: Bearer CRON_SECRET — passa direto da checagem de autorização pro banco, SEM PRECISAR de sessão de equipe nenhuma", async () => {
    // supabaseAdmin mockado pra LANÇAR (ver topo do arquivo) — usado aqui
    // como sinal: se a chamada chega a invocar supabaseAdmin(), é porque
    // passou pela única barreira de autorização desta rota (CRON_SECRET)
    // sem passar por exigirSessao()/obterContextoAutenticado() em nenhum
    // momento — uma rota que exigisse sessão de equipe teria devolvido um
    // 401 "Não autenticado" (resposta normal, sem exceção) muito antes de
    // qualquer chamada ao banco.
    await expect(
      cronPost(
        new NextRequest("http://localhost:3001/api/cron/verificar-prazos", {
          method: "POST",
          headers: { Authorization: `Bearer ${SEGREDO}` }
        })
      )
    ).rejects.toThrow("supabaseAdmin() NUNCA deveria ser chamado sem sessão válida.");
    expect(supabaseAdminMock).toHaveBeenCalled();
  });
});
