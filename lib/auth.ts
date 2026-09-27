// Autenticação própria da equipe NEXAIGEN.
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
// nunca teve uma — toda rota já chama `query()`/`withTransaction()`
// direto (ver app/api/**/route.ts). Este arquivo segue o MESMO padrão.
//
// RODADA DE MIGRAÇÃO DE INFRAESTRUTURA: Postgres direto via "pg"
// (lib/db.ts), não mais Supabase — pedido explícito da Luana, mesma
// arquitetura do nexaigen-educa. É uma migração de banco, não de
// comportamento: os mesmos dados, as mesmas condições, os mesmos
// resultados — só COMO a query roda que muda. Erros de banco antes vinham
// como `{data, error}` (Supabase); agora um erro de SQL de verdade
// (conexão caída, sintaxe, etc.) LANÇA uma exceção — diferença aceita
// (documentada no relatório desta rodada): um erro genuíno de banco vira
// um 500 real agora, em vez de ser confundido com "credencial inválida"/
// "conta não encontrada" como podia acontecer antes. Nenhuma mudança pro
// caminho feliz nem pros casos de negócio (conta inexistente, senha
// errada, conta inativa, token_version divergente) — só esse detalhe de
// erro de infraestrutura genuíno, que na prática nunca era exercitado
// (nem pelos testes, que sempre mockam a camada de banco).

import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { query } from "./db";

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
  // Claim ADICIONAL, além dos 3 originalmente pedidos (sub/nome/
  // precisa_trocar_senha) — sem isto, trocar a senha só revogaria o
  // REFRESH token (sessao), mas um access token já emitido continuaria
  // "válido" criptograficamente pelo resto dos seus 15min de vida, mesmo
  // depois de uma troca de senha forçada por suspeita de comprometimento.
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
 * sessão por igualdade direta (`where refresh_token_hash = $1`), o que
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
 * obterContextoAutenticado() do nexaigen-educa) — receber o token como
 * parâmetro (em vez de ler `next/headers#cookies()` internamente) é por
 * testabilidade: `cookies()` só funciona dentro de um contexto de
 * requisição real do Next.js. Cada chamador extrai do jeito que tiver
 * disponível (Route Handler: `req.cookies.get(...)`; Server Component:
 * `(await cookies()).get(...)`).
 *
 * NUNCA lança por CONDIÇÃO DE NEGÓCIO (token ausente/inválido/expirado,
 * conta não encontrada, conta inativa, token_version divergente sempre
 * devolvem null) — um erro de infraestrutura genuíno do Postgres (conexão
 * caída etc.) ainda pode lançar, propagando pra quem chamou.
 */
export async function obterContextoAutenticado(accessToken: string | undefined | null): Promise<ContextoAutenticado | null> {
  if (!accessToken) return null;

  const claims = await verificarAccessToken(accessToken);
  if (!claims) return null;

  const linhas = await query<{ token_version: number; ativo: boolean }>(
    `select token_version, ativo from equipe_nexaigen where id = $1`,
    [claims.sub]
  );
  const conta = linhas[0];
  if (!conta) return null;
  if (!conta.ativo) return null;
  if (conta.token_version !== claims.token_version) return null;

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
 * Date.now() — ver o comentário em db/migrations/0001_initial.sql sobre
 * por que um timestamp em vez de um incremento) e revoga toda sessão
 * (refresh token) ativa — força novo login em todos os dispositivos, não
 * só no atual.
 */
export async function trocarSenha(equipeId: string, senhaAtual: string, novaSenha: string): Promise<ResultadoTrocaSenha> {
  const linhas = await query<{ senha_hash: string }>(`select senha_hash from equipe_nexaigen where id = $1`, [equipeId]);
  const conta = linhas[0];
  if (!conta) return { sucesso: false, erro: "Conta não encontrada." };

  const senhaAtualOk = await verificarSenha(senhaAtual, conta.senha_hash);
  if (!senhaAtualOk) return { sucesso: false, erro: "Senha atual incorreta." };

  const novoHash = await hashSenha(novaSenha);
  const novoTokenVersion = Date.now();

  try {
    await query(
      `update equipe_nexaigen set senha_hash = $1, senha_temporaria = false, token_version = $2, atualizado_em = now() where id = $3`,
      [novoHash, novoTokenVersion, equipeId]
    );
  } catch {
    // Mesmo fallback que o Supabase já tinha pra esta atualização
    // específica falhar (`{error}` != null) — na prática, sem constraint
    // nenhuma nos campos atualizados aqui, é uma condição essencialmente
    // inatingível, mas preservada por completude.
    return { sucesso: false, erro: "Não foi possível trocar a senha. Tente novamente." };
  }

  await query(`update sessao set revogado_em = now() where equipe_id = $1 and revogado_em is null`, [equipeId]);

  return { sucesso: true };
}
