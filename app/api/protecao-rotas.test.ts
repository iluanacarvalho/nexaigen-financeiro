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
//
// RODADA 15-A — PERFIS DE ACESSO: matriz COMPLETA rota × papel. Pra cada
// rota da equipe (tabela ROTAS abaixo, com a ÁREA que ela deveria exigir,
// escrita à mão) e cada papel (admin, financeiro, vendas, rh):
//   - papel SEM acesso → 403 e nenhuma consulta de dado (só a da sessão);
//   - papel COM acesso → passa da autorização (chega ao banco/validação).
// E um teste lê app/api/**/route.ts do disco: rota nova (ou método novo)
// que não estiver na tabela — nem entre as rotas de segredo/autenticação —
// FALHA aqui. Sem rota sem teste.

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "chave-de-teste-jwt-apenas-unitario";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const { queryMock, lancarSempre } = vi.hoisted(() => {
  const lancarSempre = () => {
    throw new Error("query() NUNCA deveria ser chamada sem sessão válida.");
  };
  return { queryMock: vi.fn(lancarSempre), lancarSempre };
});
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
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { PAPEIS, podeAcessar, type Area } from "@/lib/papeis";
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
import { PATCH as equipePapelPatch } from "./equipe/[id]/route";
import { POST as cronPost } from "./cron/verificar-prazos/route";
import { GET as clienteGet, PATCH as clientePatch } from "./clientes/[id]/route";
import { GET as contratoGet, POST as contratoPost } from "./clientes/[id]/contrato/route";
import { POST as integracaoPost } from "./integracao/clientes/route";
import { GET as painelGet } from "./painel-financeiro/route";
import { GET as configuracaoStatusGet } from "./configuracao/status/route";
import { DELETE as cancelamentoDelete, POST as cancelamentoPost } from "./clientes/[id]/cancelamento/route";
import { POST as integracaoCancelamentoPost } from "./integracao/clientes/[municipioIdExterno]/cancelamento/route";
import { GET as relatorioContratosGet } from "./relatorios/novos-contratos/route";
import { PUT as divulgacaoPut } from "./clientes/[id]/divulgacao/route";
import * as rotaMapaPublico from "./publico/mapa-clientes/route";

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function req(url: string, method: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3001${url}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: method === "GET" ? undefined : "{}"
  });
}

const ID = "7a1b2c3d-0000-4000-8000-0000000000aa";
const ctx = { params: Promise.resolve({ id: ID }) };

/**
 * TODAS as rotas da equipe, com a área que cada uma DEVE exigir (escrita à
 * mão — se o código usar outra área, algum papel diverge e o teste falha).
 * `rota` = "MÉTODO /caminho/do/arquivo" (como no disco: [id] literal).
 */
const ROTAS: { rota: string; url: string; area: Area; handler: Handler }[] = [
  { rota: "GET /api/alertas", url: "/api/alertas", area: "alertas", handler: alertasGet as Handler },
  { rota: "GET /api/clientes", url: "/api/clientes", area: "clientes", handler: clientesGet as Handler },
  { rota: "POST /api/clientes", url: "/api/clientes", area: "clientes", handler: clientesPost as Handler },
  { rota: "GET /api/clientes/[id]", url: `/api/clientes/${ID}`, area: "clientes", handler: clienteGet as Handler },
  { rota: "PATCH /api/clientes/[id]", url: `/api/clientes/${ID}`, area: "clientes", handler: clientePatch as Handler },
  { rota: "POST /api/clientes/[id]/cancelamento", url: `/api/clientes/${ID}/cancelamento`, area: "clientes", handler: cancelamentoPost as Handler },
  { rota: "DELETE /api/clientes/[id]/cancelamento", url: `/api/clientes/${ID}/cancelamento`, area: "clientes", handler: cancelamentoDelete as Handler },
  { rota: "GET /api/clientes/[id]/contrato", url: `/api/clientes/${ID}/contrato`, area: "clientes", handler: contratoGet as Handler },
  { rota: "POST /api/clientes/[id]/contrato", url: `/api/clientes/${ID}/contrato`, area: "clientes", handler: contratoPost as Handler },
  { rota: "PUT /api/clientes/[id]/divulgacao", url: `/api/clientes/${ID}/divulgacao`, area: "clientes", handler: divulgacaoPut as Handler },
  { rota: "GET /api/clientes/[id]/contrato/versoes", url: `/api/clientes/${ID}/contrato/versoes`, area: "clientes", handler: versoesContratoGet as Handler },
  { rota: "GET /api/configuracao/status", url: "/api/configuracao/status", area: "configuracao", handler: configuracaoStatusGet as Handler },
  { rota: "GET /api/equipe", url: "/api/equipe", area: "equipe", handler: equipeGet as Handler },
  { rota: "POST /api/equipe", url: "/api/equipe", area: "equipe", handler: equipePost as Handler },
  { rota: "PATCH /api/equipe/[id]", url: `/api/equipe/${ID}`, area: "equipe", handler: equipePapelPatch as Handler },
  { rota: "GET /api/notas", url: "/api/notas", area: "notas", handler: notasGet as Handler },
  { rota: "POST /api/notas", url: "/api/notas", area: "notas", handler: notasPost as Handler },
  { rota: "POST /api/notas/[id]/acoes", url: `/api/notas/${ID}/acoes`, area: "notas", handler: acoesNotaPost as Handler },
  { rota: "GET /api/notas/[id]/arquivo", url: `/api/notas/${ID}/arquivo`, area: "notas", handler: arquivoGet as Handler },
  { rota: "POST /api/notas/[id]/arquivo", url: `/api/notas/${ID}/arquivo`, area: "notas", handler: arquivoPost as Handler },
  { rota: "GET /api/notas/[id]/arquivo/versoes", url: `/api/notas/${ID}/arquivo/versoes`, area: "notas", handler: versoesGet as Handler },
  { rota: "GET /api/notas/[id]/eventos", url: `/api/notas/${ID}/eventos`, area: "notas", handler: eventosNotaGet as Handler },
  { rota: "POST /api/notas/[id]/verificar", url: `/api/notas/${ID}/verificar`, area: "checagem", handler: verificarPost as Handler },
  { rota: "GET /api/painel-financeiro", url: "/api/painel-financeiro", area: "painel", handler: painelGet as Handler },
  { rota: "GET /api/relatorios/novos-contratos", url: "/api/relatorios/novos-contratos", area: "contratos", handler: relatorioContratosGet as Handler }
];

/**
 * PÚBLICAS DE PROPÓSITO (rodada 15-B): sem login nenhum, pra serem lidas
 * pelo site institucional. Cada uma precisa de entrada AQUI (o teste de
 * completude abaixo falha se aparecer rota sem regra) e de teste próprio
 * de que responde sem sessão — e que não expõe nada além do previsto.
 */
const ROTAS_PUBLICAS = ["GET /api/publico/mapa-clientes"];

/** Rotas que NÃO usam sessão de equipe, de propósito (cada uma com teste próprio abaixo ou em app/api/auth). */
const ROTAS_SEM_PAPEL = [
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/auth/trocar-senha",
  "POST /api/cron/verificar-prazos",
  "POST /api/integracao/clientes",
  "POST /api/integracao/clientes/[municipioIdExterno]/cancelamento"
];

beforeEach(() => {
  queryMock.mockClear();
});

describe("toda rota de API está coberta por este arquivo (sem rota sem teste)", () => {
  it("cada método exportado em app/api/**/route.ts está na matriz rota × papel ou na lista de rotas de segredo/autenticação", () => {
    const raiz = join(process.cwd(), "app", "api");
    const encontradas = (readdirSync(raiz, { recursive: true }) as string[])
      .filter((f) => f.endsWith("route.ts"))
      .flatMap((arquivo) => {
        const caminho = "/api/" + relative(raiz, join(raiz, arquivo)).replace(/\\/g, "/").replace(/\/?route\.ts$/, "");
        const metodos = [...readFileSync(join(raiz, arquivo), "utf-8").matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
        return metodos.map((m) => `${m} ${caminho}`);
      })
      .sort();
    expect(encontradas).toEqual([...ROTAS.map((r) => r.rota), ...ROTAS_SEM_PAPEL, ...ROTAS_PUBLICAS].sort());
  });
});

describe("achado crítico de segurança — toda rota da equipe exige sessão (401 sem cookie)", () => {
  it.each(ROTAS.map((r) => [r.rota, r] as const))("%s — 401, nunca chama query()", async (_rota, r) => {
    const res = await r.handler(req(r.url, r.rota.split(" ")[0]), ctx);
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("perfis de acesso (rodada 15-A) — matriz completa rota × papel", () => {
  const DADO_TOCADO = "consulta de DADO alcançada (passou da autorização)";
  let papelDaSessao = "admin";
  const cookies: Record<string, string> = {};

  beforeEach(async () => {
    for (const papel of PAPEIS) {
      cookies[papel] ??= `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId: ID, nome: "Teste", precisaTrocarSenha: false, tokenVersion: 1 })}`;
    }
    // Só a consulta da SESSÃO responde (com o papel do caso); qualquer outra lança — é o sinal de "passou da autorização".
    // withTransaction também é este mock (recebe uma função, não SQL) — conta como dado alcançado.
    queryMock.mockImplementation(((sql: unknown) => {
      if (typeof sql === "string" && sql.includes("select token_version, ativo, papel from equipe_nexaigen")) return Promise.resolve([{ token_version: 1, ativo: true, papel: papelDaSessao }]);
      throw new Error(DADO_TOCADO);
    }) as unknown as typeof lancarSempre);
  });

  afterEach(() => {
    queryMock.mockImplementation(lancarSempre);
  });

  const casos = ROTAS.flatMap((r) => PAPEIS.map((papel) => [r.rota, papel, r] as const));

  it.each(casos)("%s × %s", async (_rota, papel, r) => {
    papelDaSessao = papel;
    const executar = () => r.handler(req(r.url, r.rota.split(" ")[0], cookies[papel]), ctx);
    const consultasDeDado = () => queryMock.mock.calls.filter((chamada) => !String((chamada as unknown[])[0]).includes("from equipe_nexaigen where id")).length;

    if (podeAcessar(papel, r.area)) {
      // Liberado: chega ao banco (lança o sinal) ou para numa validação/404 — nunca 401/403.
      const res = await executar().catch((erro: Error) => {
        expect(erro.message).toBe(DADO_TOCADO);
        return null;
      });
      if (res) expect([401, 403]).not.toContain(res.status);
    } else {
      const res = await executar();
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ erro: "Seu perfil de acesso não permite esta função." });
      expect(consultasDeDado()).toBe(0);
    }
  });

  it("a matriz tem de fato rotas negadas pra cada papel não-admin (o teste não passa por vacuidade)", () => {
    for (const papel of ["financeiro", "vendas", "rh"]) expect(ROTAS.some((r) => !podeAcessar(papel, r.area))).toBe(true);
    expect(ROTAS.every((r) => podeAcessar("admin", r.area))).toBe(true);
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

describe("rota PÚBLICA de propósito: GET /api/publico/mapa-clientes (rodada 15-B)", () => {
  afterEach(() => {
    queryMock.mockImplementation(lancarSempre);
  });

  it("responde 200 SEM sessão nenhuma, só com as 4 chaves por município, e só exporta GET (o Next responde 405 aos outros métodos)", async () => {
    // A única consulta da rota: a leitura do mapa (rate limit está mockado neste arquivo).
    queryMock.mockImplementation(((sql: unknown) => {
      if (typeof sql === "string" && sql.includes("from cliente_prefeitura")) {
        return Promise.resolve([{ nome: "Prefeitura de Teste", uf: "PR", status_contrato: "ativo", cancelamento_termino_em: null, autorizacao_divulgacao: true, latitude: "-25.400000", longitude: "-49.200000" }]);
      }
      throw new Error("consulta inesperada na rota pública");
    }) as unknown as typeof lancarSempre);
    const res = await rotaMapaPublico.GET(req("/api/publico/mapa-clientes", "GET"));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(Object.keys(corpo).sort()).toEqual(["atualizadoEm", "municipios", "total"]);
    expect(corpo.municipios).toEqual([{ nome: "Prefeitura de Teste", uf: "PR", lat: -25.4, lon: -49.2 }]);
    expect(Object.keys(rotaMapaPublico).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["GET"]);
  });

  it("as rotas da equipe continuam 401 sem sessão (a rota pública não abriu nada)", async () => {
    for (const r of ROTAS) {
      const res = await r.handler(req(r.url, r.rota.split(" ")[0]), ctx);
      expect(res.status).toBe(401);
    }
  });
});
