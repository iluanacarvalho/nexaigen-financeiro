// Login da equipe NEXAIGEN — 401 genérico se e-mail não existe OU senha
// errada (nunca revela qual dos dois), 403 se a conta estiver inativa.
// Emite access token (JWT, 15min) + refresh token (7 dias, hash gravado
// em `sessao`).
//
// LIMITE DE TENTATIVAS (rodada 07, lib/rateLimit.ts): 5 falhas em 15 min
// por e-mail normalizado E por IP → 429 com Retry-After. Toda tentativa
// soma 1 ANTES de conferir a senha (atômico, sem corrida sob rajada); se
// a senha confere, o contador do e-mail é zerado e a tentativa do IP é
// devolvida — só falha acumula. O 429 vale pra qualquer e-mail digitado,
// exista ou não, então também não revela existência de conta.
//
// TEMPO DE RESPOSTA: e-mail inexistente roda a mesma verificação bcrypt
// (contra lib/auth.ts#HASH_FANTASMA) que uma senha errada — o tempo não
// diferencia "não existe" de "senha errada".

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import {
  DURACAO_REFRESH_TOKEN_MS,
  NOME_COOKIE_ACCESS,
  NOME_COOKIE_REFRESH,
  gerarAccessToken,
  gerarRefreshToken,
  hashRefreshToken,
  opcoesCookieAccessToken,
  opcoesCookieRefreshToken,
  verificarSenhaDaConta
} from "@/lib/auth";
import {
  LIMITE_LOGIN_POR_EMAIL,
  LIMITE_LOGIN_POR_IP,
  desfazerTentativa,
  normalizarEmail,
  obterIpCliente,
  registrarTentativa,
  respostaLimiteExcedido,
  zerarContador
} from "@/lib/rateLimit";

const LoginSchema = z.object({
  email: z.email(),
  senha: z.string().min(1)
});

const ERRO_GENERICO = { erro: "E-mail ou senha inválidos." } as const;

interface ContaLinha {
  id: string;
  nome: string;
  senha_hash: string;
  senha_temporaria: boolean;
  token_version: number;
  ativo: boolean;
}

export async function POST(req: NextRequest) {
  const parsed = LoginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const email = normalizarEmail(parsed.data.email);
  const { senha } = parsed.data;
  const ip = obterIpCliente(req);

  const [porIp, porEmail] = await Promise.all([
    registrarTentativa(LIMITE_LOGIN_POR_IP, ip),
    registrarTentativa(LIMITE_LOGIN_POR_EMAIL, email)
  ]);
  const bloqueios = [porIp, porEmail].filter((r) => !r.permitido);
  if (bloqueios.length > 0) return respostaLimiteExcedido(Math.max(...bloqueios.map((r) => r.retryAfterSegundos)));

  const linhas = await query<ContaLinha>(
    `select id, nome, senha_hash, senha_temporaria, token_version, ativo from equipe_nexaigen where email = $1`,
    [email]
  );
  const conta = linhas[0];

  if (!(await verificarSenhaDaConta(senha, conta?.senha_hash ?? null)) || !conta) {
    return NextResponse.json(ERRO_GENERICO, { status: 401 });
  }

  // Senha certa: a tentativa não conta como falha.
  await Promise.all([zerarContador(LIMITE_LOGIN_POR_EMAIL, email), desfazerTentativa(LIMITE_LOGIN_POR_IP, ip)]);

  if (!conta.ativo) {
    return NextResponse.json({ erro: "Conta desativada. Fale com um colega da equipe." }, { status: 403 });
  }

  const accessToken = await gerarAccessToken({
    equipeId: conta.id,
    nome: conta.nome,
    precisaTrocarSenha: conta.senha_temporaria,
    tokenVersion: conta.token_version
  });
  const refreshToken = gerarRefreshToken();
  await query(`insert into sessao (equipe_id, refresh_token_hash, expira_em) values ($1, $2, $3)`, [
    conta.id,
    hashRefreshToken(refreshToken),
    new Date(Date.now() + DURACAO_REFRESH_TOKEN_MS).toISOString()
  ]);

  const resposta = NextResponse.json({
    nome: conta.nome,
    precisa_trocar_senha: conta.senha_temporaria
  });
  resposta.cookies.set(NOME_COOKIE_ACCESS, accessToken, opcoesCookieAccessToken());
  resposta.cookies.set(NOME_COOKIE_REFRESH, refreshToken, opcoesCookieRefreshToken());
  return resposta;
}
