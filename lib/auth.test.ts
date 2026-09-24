// Testes unitários do login da equipe NEXAIGEN (rodada de correção de
// achado crítico de segurança) — mesmo padrão de mock já estabelecido em
// app/api/cron/verificar-prazos/route.test.ts: mocka @/lib/supabase/server
// (supabaseAdmin), nunca toca banco real. JWT_SECRET setado direto (mesmo
// padrão de lib/auth.test.ts do projeto irmão nexaigen-educa) — não
// precisa de nenhuma infraestrutura externa pra rodar.

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "chave-de-teste-jwt-apenas-unitario";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseAdminMock } = vi.hoisted(() => ({ supabaseAdminMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: supabaseAdminMock }));

import { SignJWT } from "jose";
import {
  exigirSessao,
  gerarAccessToken,
  gerarRefreshToken,
  hashRefreshToken,
  hashSenha,
  obterContextoAutenticado,
  trocarSenha,
  verificarAccessToken,
  verificarSenha,
  type ContextoAutenticado
} from "./auth";

// --- Fake Supabase client — mesmo idioma de app/api/cron/verificar-prazos/route.test.ts:
// builder fluente por tabela, cada teste configura o que precisa via
// mockReturnValue/mockResolvedValue nos pontos que realmente usa. ---
function criarSupabaseFake(overrides: {
  equipeMaybeSingle?: any;
  equipeUpdateResult?: { error: any } | null;
  sessaoUpdateResult?: { error: any } | null;
}) {
  const equipeBuilder: any = {
    select: () => equipeBuilder,
    eq: () => equipeBuilder,
    update: () => equipeBuilder,
    maybeSingle: () => Promise.resolve(overrides.equipeMaybeSingle ?? { data: null, error: null })
  };
  // update().eq() precisa resolver pro resultado configurado — como select/eq
  // acima retornam o mesmo builder, o "eq" final do update também passa por
  // aqui; resolvido via then() pra funcionar tanto com quanto sem await direto.
  equipeBuilder.then = (resolve: any) => resolve(overrides.equipeUpdateResult ?? { error: null });

  const sessaoBuilder: any = {
    update: () => sessaoBuilder,
    eq: () => sessaoBuilder,
    is: () => Promise.resolve(overrides.sessaoUpdateResult ?? { error: null })
  };

  return {
    from: (tabela: string) => (tabela === "sessao" ? sessaoBuilder : equipeBuilder)
  };
}

beforeEach(() => {
  supabaseAdminMock.mockReset();
});

describe("hashSenha / verificarSenha", () => {
  it("hash da senha nunca é igual à senha em texto puro, e verifica corretamente", async () => {
    const hash = await hashSenha("MinhaSenha123");
    expect(hash).not.toBe("MinhaSenha123");
    expect(hash.startsWith("$2")).toBe(true); // prefixo padrão de hash bcrypt

    expect(await verificarSenha("MinhaSenha123", hash)).toBe(true);
    expect(await verificarSenha("SenhaErrada999", hash)).toBe(false);
  });
});

describe("gerarRefreshToken / hashRefreshToken", () => {
  it("gera tokens de alta entropia, nunca repetidos, e o hash nunca é reversível pro token original", () => {
    const t1 = gerarRefreshToken();
    const t2 = gerarRefreshToken();
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThanOrEqual(32);

    const hash = hashRefreshToken(t1);
    expect(hash).not.toBe(t1);
    // sha256 hex tem sempre 64 caracteres.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Determinístico — mesmo token sempre produz o mesmo hash (necessário
    // pra buscar a sessão por igualdade direta).
    expect(hashRefreshToken(t1)).toBe(hash);
  });
});

describe("gerarAccessToken / verificarAccessToken", () => {
  it("round-trip preserva sub, nome, precisa_trocar_senha e token_version", async () => {
    const token = await gerarAccessToken({ equipeId: "equipe-1", nome: "Luana Carvalho", precisaTrocarSenha: true, tokenVersion: 7 });

    const claims = await verificarAccessToken(token);
    expect(claims).toEqual({ sub: "equipe-1", nome: "Luana Carvalho", precisa_trocar_senha: true, token_version: 7 });
  });

  it("token malformado/assinatura inválida devolve null, nunca lança", async () => {
    await expect(verificarAccessToken("token.invalido.aqui")).resolves.toBeNull();
  });

  it("token expirado devolve null", async () => {
    vi.useFakeTimers();
    const token = await gerarAccessToken({ equipeId: "equipe-1", nome: "Luana", precisaTrocarSenha: false, tokenVersion: 1 });
    vi.advanceTimersByTime(16 * 60 * 1000); // 16min — além dos 15min de vida do token
    const claims = await verificarAccessToken(token);
    vi.useRealTimers();
    expect(claims).toBeNull();
  });

  it("token sem o claim precisa_trocar_senha (formato hipotético antigo) é tratado como false, não quebra", async () => {
    const segredo = new TextEncoder().encode(process.env.JWT_SECRET!);
    const tokenAntigo = await new SignJWT({ nome: "Colega", token_version: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("equipe-1")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(segredo);

    const claims = await verificarAccessToken(tokenAntigo);
    expect(claims).not.toBeNull();
    expect(claims?.precisa_trocar_senha).toBe(false);
  });
});

describe("obterContextoAutenticado — sessão válida/inválida/ausente/expirada", () => {
  it("token ausente (undefined/null) — devolve null, nunca consulta o banco", async () => {
    expect(await obterContextoAutenticado(undefined)).toBeNull();
    expect(await obterContextoAutenticado(null)).toBeNull();
    expect(supabaseAdminMock).not.toHaveBeenCalled();
  });

  it("token com assinatura inválida — devolve null, nunca consulta o banco", async () => {
    expect(await obterContextoAutenticado("lixo.nao.valido")).toBeNull();
    expect(supabaseAdminMock).not.toHaveBeenCalled();
  });

  it("token expirado — devolve null", async () => {
    vi.useFakeTimers();
    const token = await gerarAccessToken({ equipeId: "equipe-1", nome: "Luana", precisaTrocarSenha: false, tokenVersion: 1 });
    vi.advanceTimersByTime(16 * 60 * 1000);
    const contexto = await obterContextoAutenticado(token);
    vi.useRealTimers();
    expect(contexto).toBeNull();
  });

  it("token válido mas conta não encontrada no banco — devolve null", async () => {
    const token = await gerarAccessToken({ equipeId: "equipe-apagada", nome: "Fulano", precisaTrocarSenha: false, tokenVersion: 1 });
    supabaseAdminMock.mockReturnValue(criarSupabaseFake({ equipeMaybeSingle: { data: null, error: null } }));

    expect(await obterContextoAutenticado(token)).toBeNull();
  });

  it("token válido mas conta inativa — devolve null", async () => {
    const token = await gerarAccessToken({ equipeId: "equipe-1", nome: "Luana", precisaTrocarSenha: false, tokenVersion: 1 });
    supabaseAdminMock.mockReturnValue(
      criarSupabaseFake({ equipeMaybeSingle: { data: { token_version: 1, ativo: false }, error: null } })
    );

    expect(await obterContextoAutenticado(token)).toBeNull();
  });

  it("token válido mas token_version não bate com o banco (senha trocada/sessão revogada em outro lugar) — devolve null", async () => {
    const token = await gerarAccessToken({ equipeId: "equipe-1", nome: "Luana", precisaTrocarSenha: false, tokenVersion: 1 });
    supabaseAdminMock.mockReturnValue(
      criarSupabaseFake({ equipeMaybeSingle: { data: { token_version: 999, ativo: true }, error: null } })
    );

    expect(await obterContextoAutenticado(token)).toBeNull();
  });

  it("token válido, conta ativa, token_version bate — devolve o contexto completo", async () => {
    const token = await gerarAccessToken({ equipeId: "equipe-1", nome: "Luana Carvalho", precisaTrocarSenha: true, tokenVersion: 3 });
    supabaseAdminMock.mockReturnValue(
      criarSupabaseFake({ equipeMaybeSingle: { data: { token_version: 3, ativo: true }, error: null } })
    );

    const contexto = await obterContextoAutenticado(token);
    expect(contexto).toEqual({ equipeId: "equipe-1", nome: "Luana Carvalho", precisaTrocarSenha: true });
  });
});

describe("exigirSessao", () => {
  function contexto(overrides: Partial<ContextoAutenticado> = {}): ContextoAutenticado {
    return { equipeId: "equipe-1", nome: "Luana Carvalho", precisaTrocarSenha: false, ...overrides };
  }

  it("contexto ausente (null) — 401", async () => {
    const resposta = exigirSessao(null);
    expect(resposta).not.toBeNull();
    expect(resposta!.status).toBe(401);
    const corpo = await resposta!.json();
    expect(corpo.erro).toBeTruthy();
  });

  it("contexto com senha temporária pendente — 403, com precisa_trocar_senha:true", async () => {
    const resposta = exigirSessao(contexto({ precisaTrocarSenha: true }));
    expect(resposta).not.toBeNull();
    expect(resposta!.status).toBe(403);
    const corpo = await resposta!.json();
    expect(corpo.precisa_trocar_senha).toBe(true);
  });

  it("contexto válido, senha já trocada — libera (null)", () => {
    expect(exigirSessao(contexto())).toBeNull();
  });
});

describe("trocarSenha", () => {
  const CONTA_ID = "equipe-1";

  it("conta não encontrada — sucesso false, nunca atualiza nada", async () => {
    supabaseAdminMock.mockReturnValue(criarSupabaseFake({ equipeMaybeSingle: { data: null, error: null } }));

    const resultado = await trocarSenha(CONTA_ID, "qualquer", "NovaSenha123");
    expect(resultado).toEqual({ sucesso: false, erro: "Conta não encontrada." });
  });

  it("senha atual incorreta — sucesso false, nunca atualiza nada", async () => {
    const hashReal = await hashSenha("SenhaCerta123");
    supabaseAdminMock.mockReturnValue(criarSupabaseFake({ equipeMaybeSingle: { data: { senha_hash: hashReal }, error: null } }));

    const resultado = await trocarSenha(CONTA_ID, "SenhaErrada999", "NovaSenha123");
    expect(resultado).toEqual({ sucesso: false, erro: "Senha atual incorreta." });
  });

  it("senha atual correta — sucesso true", async () => {
    const hashReal = await hashSenha("SenhaCerta123");
    supabaseAdminMock.mockReturnValue(criarSupabaseFake({ equipeMaybeSingle: { data: { senha_hash: hashReal }, error: null } }));

    const resultado = await trocarSenha(CONTA_ID, "SenhaCerta123", "NovaSenha456");
    expect(resultado).toEqual({ sucesso: true });
  });
});
