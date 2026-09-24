// Autenticação própria da equipe NEXAIGEN — ACHADO CRÍTICO DE SEGURANÇA
// (rodada de correção): este projeto nunca teve login nenhum. `usuario_interno`
// (supabase/schema.sql) foi pensada pra isso mas NUNCA foi lida/checada em
// nenhuma rota — confirmado por busca no repo inteiro antes desta rodada
// (zero ocorrências de "usuario_interno" fora do próprio schema.sql).
// Toda rota de API e toda página estavam completamente abertas, sem
// verificação de sessão nenhuma. Ver o comentário na Seção 1 de
// supabase/schema.sql pro raciocínio completo de por que `usuario_interno`
// foi removida (nunca usada) em favor de `equipe_nexaigen`.
//
// Mesmo contrato de robustez do login de equipe do projeto irmão
// nexaigen-educa (bcrypt custo 12, JWT HS256 15min de access token via
// `jose`, refresh token de 7 dias com hash sha256 gravado em `sessao`,
// cookies httpOnly) — mas SEM multi-tenant: este projeto só tem UM tipo de
// usuário (a própria equipe NEXAIGEN), sem papel, sem hierarquia. Qualquer
// pessoa da equipe logada pode cadastrar outra (ver POST /api/equipe) —
// não existe um "exigirPapel" aqui porque não existe papel nenhum pra
// checar, só "existe sessão válida ou não" (exigirSessao, abaixo).
//
// SEM camada de repositório (diferente do nexaigen-educa): este projeto
// nunca teve uma — toda rota já chama `supabaseServer()`/`supabaseAdmin()`
// direto (ver app/api/**/route.ts existentes). Este arquivo segue o MESMO
// padrão, chamando `supabaseAdmin()` diretamente pra equipe_nexaigen/sessao,
// em vez de introduzir uma camada nova só pra este recurso.
//
// `supabaseAdmin()` (service_role, ignora RLS), não `supabaseServer()`
// (chave anon, RLS-gated) — decisão necessária, não estética: este login é
// 100% independente do Supabase Auth (nunca chama `supabase.auth.signIn*`),
// então `auth.uid()` é sempre null nas policies de RLS. Usar a chave anon
// aqui faria toda leitura/escrita de equipe_nexaigen/sessao ser barrada
// pela própria RLS (que agora nega tudo por padrão, ver schema.sql) —
// o controle de acesso real passa a ser exigirSessao(), chamado em toda
// rota, não mais RLS.

import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase/server";

const CUSTO_BCRYPT = 12;
const DURACAO_ACCESS_TOKEN = "15m";
export const DURACAO_REFRESH_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;

export const NOME_COOKIE_ACCESS = "access_token";
export const NOME_COOKIE_REFRESH = "refresh_token";

function segredoJwt(): Uint8Array {
  const segredo = process.env.JWT_SECRET;
  if (!segredo) throw new Error("JWT_SECRET não configurada.");
  return new TextEncoder().encode(segredo);
}

// --- Senha ---------------------------------------------------------------

export async function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, CUSTO_BCRYPT);
}

export async function verificarSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}

/**
 * Senha temporária gerada em POST /api/equipe e no bootstrap — volta na
 * própria resposta UMA VEZ (não existe canal de notificação real nesta
 * plataforma interna), a pessoa troca no primeiro acesso (POST
 * /api/auth/trocar-senha). Mesmo formato/entropia do gerador equivalente
 * em lib/auth.ts do nexaigen-educa — duplicado aqui de propósito (são
 * repositórios/projetos separados, sem pacote compartilhado entre os
 * dois): alfabeto sem caracteres ambíguos (sem 0/O/1/I/l), 2 blocos de 4
 * via crypto.randomBytes.
 */
export function gerarSenhaTemporaria(): string {
  const alfabeto = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bloco = () =>
    Array.from(randomBytes(4))
      .map((b) => alfabeto[b % alfabeto.length])
      .join("");
  return `Temp-${bloco()}-${bloco()}`;
}

// --- Access token (JWT) ---------------------------------------------------

export interface ClaimsAccessToken {
  sub: string; // equipe_nexaigen.id
  nome: string;
  precisa_trocar_senha: boolean;
  // Claim ADICIONAL, além dos 3 pedidos — decisão desta rodada, não do
  // pedido original: sem isto, trocar a senha só revogaria o REFRESH
  // token (sessao), mas um access token já emitido continuaria "válido"
  // criptograficamente pelo resto dos seus 15min de vida, mesmo depois de
  // uma troca de senha forçada por suspeita de comprometimento — mesmo
  // gap que motivou token_version no nexaigen-educa. Dado que este
  // projeto guarda dado financeiro/contato real de cliente e a própria
  // razão desta rodada é "prioridade máxima, corrigir antes de qualquer
  // uso real", pareceu errado deixar esse gap por não estar explicitamente
  // listado no pedido.
  token_version: number;
}

export async function gerarAccessToken(dados: {
  equipeId: string;
  nome: string;
  precisaTrocarSenha: boolean;
  tokenVersion: number;
}): Promise<string> {
  return new SignJWT({
    nome: dados.nome,
    precisa_trocar_senha: dados.precisaTrocarSenha,
    token_version: dados.tokenVersion
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(dados.equipeId)
    .setIssuedAt()
    .setExpirationTime(DURACAO_ACCESS_TOKEN)
    .sign(segredoJwt());
}

export async function verificarAccessToken(token: string): Promise<ClaimsAccessToken | null> {
  try {
    const { payload } = await jwtVerify(token, segredoJwt());
    if (typeof payload.sub !== "string" || typeof payload.nome !== "string" || typeof payload.token_version !== "number") {
      return null;
    }
    return {
      sub: payload.sub,
      nome: payload.nome,
      precisa_trocar_senha: typeof payload.precisa_trocar_senha === "boolean" ? payload.precisa_trocar_senha : false,
      token_version: payload.token_version
    };
  } catch {
    // Assinatura inválida, token expirado, ou qualquer outro erro de
    // verificação — NUNCA lança, sempre null (contrato do pedido).
    return null;
  }
}

// --- Refresh token ---------------------------------------------------------

export function gerarRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * sha256, não bcrypt: o refresh token já nasce com 256 bits de entropia
 * (crypto.randomBytes), diferente de uma senha escolhida por humano — não
 * precisa de um hash lento/salgado. sha256 também permite localizar a
 * sessão por igualdade direta (`.eq("refresh_token_hash", ...)`), o que
 * bcrypt não permitiria sem comparar contra toda sessão ativa uma a uma.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// --- Cookies -----------------------------------------------------------

function opcoesCookieBase() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/"
  };
}

export function opcoesCookieAccessToken() {
  return { ...opcoesCookieBase(), maxAge: 15 * 60 };
}

export function opcoesCookieRefreshToken() {
  return { ...opcoesCookieBase(), maxAge: DURACAO_REFRESH_TOKEN_MS / 1000 };
}

// --- Contexto autenticado --------------------------------------------------

export interface ContextoAutenticado {
  equipeId: string;
  nome: string;
  precisaTrocarSenha: boolean;
}

/**
 * Recebe o access token já extraído (mesmo contrato de
 * obterContextoAutenticado() do nexaigen-educa) — DECISÃO desta rodada:
 * mesmo este projeto não tendo middleware/proxy.ts, receber o token como
 * parâmetro (em vez de chamar `next/headers#cookies()` internamente) foi
 * escolhido de propósito por testabilidade. `cookies()` só funciona dentro
 * de um contexto de requisição real do Next.js (Route Handler/Server
 * Component em execução) — chamar esta função direto de um teste unitário
 * (vitest puro, sem o runtime do Next.js) lançaria "cookies was called
 * outside a request scope" antes mesmo de chegar na lógica que o teste
 * quer exercitar. Recebendo o token pronto, cada chamador extrai do jeito
 * que tiver disponível (Route Handler: `req.cookies.get(...)`; Server
 * Component: `(await cookies()).get(...)`) e a função em si vira 100%
 * testável passando uma string direto.
 *
 * NUNCA lança — qualquer falha de validação (token ausente/inválido/
 * expirado, conta não encontrada, conta inativa, token_version
 * divergente) devolve null.
 */
export async function obterContextoAutenticado(accessToken: string | undefined | null): Promise<ContextoAutenticado | null> {
  if (!accessToken) return null;

  const claims = await verificarAccessToken(accessToken);
  if (!claims) return null;

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("equipe_nexaigen")
    .select("token_version, ativo")
    .eq("id", claims.sub)
    .maybeSingle();

  if (error || !data) return null;
  if (!data.ativo) return null;
  if (data.token_version !== claims.token_version) return null;

  return { equipeId: claims.sub, nome: claims.nome, precisaTrocarSenha: claims.precisa_trocar_senha };
}

/**
 * Nega o acesso (401 sem sessão, 403 com senha temporária pendente) ou
 * libera (retorna null) — mesmo espírito de exigirPapel() do
 * nexaigen-educa, sem parâmetro de papel: não existe papel nesta
 * identidade, só "está logado" ou não. Uso típico numa rota:
 *
 *   const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
 *   const negado = exigirSessao(contexto);
 *   if (negado) return negado;
 *   // dali pra baixo, contexto! é garantidamente não-nulo E já trocou a senha temporária
 *
 * O bloqueio de senha temporária fica CENTRALIZADO aqui (não em cada
 * rota, nem só na página /trocar-senha) DE PROPÓSITO: este projeto não
 * tem middleware/proxy.ts (diferente do nexaigen-educa, que faz essa
 * checagem lá) — todo chamador de exigirSessao() é exatamente uma rota
 * que deveria ficar bloqueada enquanto a senha temporária não for
 * trocada (equipe, clientes, notas, alertas); as rotas de
 * login/logout/trocar-senha nunca chamam exigirSessao(), então nunca são
 * afetadas por este bloqueio (precisam funcionar ANTES/PARA sair deste
 * estado). Sem isto, uma conta recém-criada (sempre com
 * senha_temporaria=true) poderia usar a API inteira sem nunca trocar a
 * senha — o redirect de UI em app/(protegido)/layout.tsx sozinho não
 * impede uma chamada direta à API.
 */
export function exigirSessao(contexto: ContextoAutenticado | null): NextResponse | null {
  if (!contexto) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  if (contexto.precisaTrocarSenha) {
    return NextResponse.json({ erro: "Troque sua senha temporária antes de continuar.", precisa_trocar_senha: true }, { status: 403 });
  }
  return null;
}

// --- Troca de senha ----------------------------------------------------

export interface ResultadoTrocaSenha {
  sucesso: boolean;
  erro?: string;
}

/**
 * Invalida TODO access token já emitido (grava um token_version novo,
 * Date.now() — ver o comentário em supabase/schema.sql sobre por que um
 * timestamp em vez de um incremento) e revoga toda sessão (refresh token)
 * ativa — força novo login em todos os dispositivos, não só no atual.
 */
export async function trocarSenha(equipeId: string, senhaAtual: string, novaSenha: string): Promise<ResultadoTrocaSenha> {
  const supabase = supabaseAdmin();

  const { data: conta, error: erroBusca } = await supabase
    .from("equipe_nexaigen")
    .select("senha_hash")
    .eq("id", equipeId)
    .maybeSingle();
  if (erroBusca || !conta) return { sucesso: false, erro: "Conta não encontrada." };

  const senhaAtualOk = await verificarSenha(senhaAtual, conta.senha_hash);
  if (!senhaAtualOk) return { sucesso: false, erro: "Senha atual incorreta." };

  const novoHash = await hashSenha(novaSenha);
  const novoTokenVersion = Date.now();

  const { error: erroUpdate } = await supabase
    .from("equipe_nexaigen")
    .update({
      senha_hash: novoHash,
      senha_temporaria: false,
      token_version: novoTokenVersion,
      atualizado_em: new Date().toISOString()
    })
    .eq("id", equipeId);
  if (erroUpdate) return { sucesso: false, erro: "Não foi possível trocar a senha. Tente novamente." };

  await supabase.from("sessao").update({ revogado_em: new Date().toISOString() }).eq("equipe_id", equipeId).is("revogado_em", null);

  return { sucesso: true };
}
