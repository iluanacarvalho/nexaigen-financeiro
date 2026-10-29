// Limite de tentativas em Postgres (db/migrations/0006_rate_limit.sql) —
// login, troca de senha e a rota de integração com o nexaigen-educa.
//
// JANELA FIXA por chave: a tentativa cai no bloco de `janelaSegundos` em
// que o RELÓGIO DO BANCO está (todas as instâncias usam o mesmo relógio).
// Consequência conhecida de janela fixa: na virada de um bloco pro
// seguinte o contador recomeça, então no pior caso cabem 2×limite
// tentativas em pouco tempo (fim de um bloco + começo do próximo). Pro
// objetivo aqui — tornar força bruta inviável (5 por 15 min = 480/dia por
// e-mail, contra bcrypt) — isso é suficiente.
//
// INCREMENTA PRIMEIRO, DECIDE DEPOIS: `registrarTentativa` soma 1 e lê o
// total na MESMA instrução (`insert ... on conflict do update ...
// returning`). Uma rajada de N requisições simultâneas recebe contagens
// 1..N, sem repetir — a de número limite+1 é recusada, não importa a
// ordem de chegada. (Ler o total e só depois registrar teria a janela de
// corrida clássica: todas leem "4" antes de qualquer uma gravar.) Quando
// a tentativa acaba dando CERTO, quem chamou devolve com
// `desfazerTentativa` (ou zera com `zerarContador`) — é assim que só as
// FALHAS acumulam.
//
// PRIVACIDADE: a chave gravada é `<prefixo>:<sha256(identificador)>` —
// nem e-mail nem IP ficam em claro na tabela.

import { createHash } from "node:crypto";
import { query, type Executor } from "./db";

export interface RegraLimite {
  /** Namespace da chave, ex. "login:email". */
  prefixo: string;
  /** Máximo de tentativas permitidas por janela (a limite+1ª é recusada). */
  limite: number;
  janelaSegundos: number;
}

export interface ResultadoLimite {
  permitido: boolean;
  contagem: number;
  /** Segundos até a janela atual acabar (≥ 1) — valor do header Retry-After. */
  retryAfterSegundos: number;
}

// --- Regras usadas no projeto ---------------------------------------------

const QUINZE_MINUTOS = 15 * 60;

/** Login: 5 falhas por e-mail (normalizado) em 15 min. */
export const LIMITE_LOGIN_POR_EMAIL: RegraLimite = { prefixo: "login:email", limite: 5, janelaSegundos: QUINZE_MINUTOS };
/** Login: 5 falhas por IP em 15 min (sucesso devolve a tentativa — só falha conta). */
export const LIMITE_LOGIN_POR_IP: RegraLimite = { prefixo: "login:ip", limite: 5, janelaSegundos: QUINZE_MINUTOS };
/** Troca de senha: 10 tentativas por conta da equipe em 15 min. */
export const LIMITE_TROCAR_SENHA: RegraLimite = { prefixo: "trocar-senha:equipe", limite: 10, janelaSegundos: QUINZE_MINUTOS };
/** Integração Educa: 60 requisições por IP por minuto. */
export const LIMITE_INTEGRACAO_POR_IP: RegraLimite = { prefixo: "integracao:ip", limite: 60, janelaSegundos: 60 };
/** Integração Educa: 10 falhas de autenticação por IP em 15 min. */
export const LIMITE_INTEGRACAO_FALHA_AUTH: RegraLimite = { prefixo: "integracao:falha-auth", limite: 10, janelaSegundos: QUINZE_MINUTOS };

// --- Funções puras --------------------------------------------------------

/** Chave gravada: `<prefixo>:<sha256 hex do identificador>` — nunca o identificador em claro. */
export function chaveLimite(prefixo: string, identificador: string): string {
  return `${prefixo}:${createHash("sha256").update(identificador).digest("hex")}`;
}

/** E-mail normalizado pro contador: sem espaços nas pontas, minúsculo — o mesmo e-mail com outra caixa é a MESMA conta. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

const TAMANHO_MAXIMO_IP = 64;

/**
 * IP do cliente: primeiro valor de `x-forwarded-for` (o proxy do Railway
 * preenche), senão `x-real-ip`, senão "desconhecido". Fallback SEGURO:
 * requisição sem nenhum dos dois não fica sem limite — cai toda no mesmo
 * balde "desconhecido". Valor vazio ou absurdamente longo também vai pro
 * balde comum (não vira uma chave nova a cada requisição).
 */
export function obterIpCliente(req: Request): string {
  const candidatos = [req.headers.get("x-forwarded-for")?.split(",")[0], req.headers.get("x-real-ip")];
  for (const candidato of candidatos) {
    const ip = candidato?.trim();
    if (ip && ip.length <= TAMANHO_MAXIMO_IP) return ip;
  }
  return "desconhecido";
}

// --- Banco ----------------------------------------------------------------

// Início da janela atual, calculado PELO BANCO (mesmo relógio pra todas as instâncias).
const INICIO_JANELA_SQL = `to_timestamp(floor(extract(epoch from now()) / $2::int) * $2::int)`;

/** Soma 1 tentativa na janela atual e diz se ainda está dentro do limite. Atômico (uma instrução). */
export async function registrarTentativa(regra: RegraLimite, identificador: string, executor?: Executor): Promise<ResultadoLimite> {
  const [linha] = await query<{ contagem: number; retry_after: number }>(
    `insert into rate_limit_contador (chave, janela_inicio, contagem)
     values ($1, ${INICIO_JANELA_SQL}, 1)
     on conflict (chave, janela_inicio) do update set contagem = rate_limit_contador.contagem + 1
     returning contagem, ceil(extract(epoch from (janela_inicio + make_interval(secs => $2::int) - now())))::int as retry_after`,
    [chaveLimite(regra.prefixo, identificador), regra.janelaSegundos],
    executor
  );
  return {
    permitido: linha.contagem <= regra.limite,
    contagem: linha.contagem,
    retryAfterSegundos: Math.max(1, linha.retry_after)
  };
}

/** Devolve 1 tentativa da janela atual (a tentativa deu certo — não deve contar como falha). Nunca fica negativo. */
export async function desfazerTentativa(regra: RegraLimite, identificador: string, executor?: Executor): Promise<void> {
  await query(
    `update rate_limit_contador set contagem = greatest(contagem - 1, 0)
     where chave = $1 and janela_inicio = ${INICIO_JANELA_SQL}`,
    [chaveLimite(regra.prefixo, identificador), regra.janelaSegundos],
    executor
  );
}

/** Zera o contador da chave (todas as janelas) — ex.: login bem-sucedido daquele e-mail. */
export async function zerarContador(regra: RegraLimite, identificador: string, executor?: Executor): Promise<void> {
  await query(`delete from rate_limit_contador where chave = $1`, [chaveLimite(regra.prefixo, identificador)], executor);
}

/** Apaga contadores de janelas com mais de 1 dia (nenhuma regra usa janela maior). Chamado pelo job diário. */
export async function limparContadoresExpirados(executor?: Executor): Promise<number> {
  const removidas = await query<{ chave: string }>(
    `delete from rate_limit_contador where janela_inicio < now() - interval '1 day' returning chave`,
    [],
    executor
  );
  return removidas.length;
}

/** Resposta 429 padrão (corpo genérico + Retry-After em segundos). */
export function respostaLimiteExcedido(retryAfterSegundos: number): Response {
  const minutos = Math.ceil(retryAfterSegundos / 60);
  return Response.json(
    { erro: `Muitas tentativas. Tente novamente em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.` },
    { status: 429, headers: { "retry-after": String(retryAfterSegundos) } }
  );
}
