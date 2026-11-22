// Escrita da divulgação no mapa público (rodada 15-B) — tela de Clientes,
// PUT /api/clientes/[id]/divulgacao. Cada ação numa transação com o
// cliente travado (`select ... for update`): duas ações simultâneas são
// serializadas e a segunda já vê a primeira.
//
//   - definirCodigoIbge: grava o código e a posição (centroide vindo do
//     IBGE — a consulta de rede acontece ANTES, fora da transação; posição
//     null = "posição pendente"). Recusado enquanto o cliente estiver
//     AUTORIZADO: trocar o município de quem está no mapa público exige
//     revogar antes (evita mover/apagar um ponto público sem querer).
//   - autorizar: exige código e posição (o CHECK da 0013 garante de novo) e
//     contrato JÁ ASSINADO (16-B1: 'aguardando_assinatura' é recusado);
//     grava quando e quem; evento 'divulgacao_autorizada'.
//   - revogar: sai do mapa NA HORA no banco (o cache de 60s é só de borda,
//     no endpoint público); limpa quando/quem; evento 'divulgacao_revogada'.
// A trilha é a mesma cliente_evento_contrato (origem 'painel', autor = a
// sessão) — a lógica de contrato filtra os tipos de contrato
// (lib/cancelamentoServico.ts#TIPOS_EVENTO_CONTRATO).

import { query, withTransaction, type Executor } from "./db";

export type ResultadoDivulgacao =
  | { ok: true; nome: string; uf: string }
  | { ok: false; motivo: "nao_encontrado" | "codigo_em_uso" | "transicao_invalida"; erro: string };

interface ClienteTravado {
  nome: string;
  uf: string;
  codigo_ibge: string | null;
  latitude: string | null;
  autorizacao_divulgacao: boolean;
  status_contrato: string;
}

class Recusa extends Error {
  constructor(readonly resultado: Extract<ResultadoDivulgacao, { ok: false }>) {
    super("ação de divulgação recusada");
  }
}

const NAO_ENCONTRADO = { ok: false as const, motivo: "nao_encontrado" as const, erro: "Cliente não encontrado." };

async function travar(c: Executor, clienteId: string): Promise<ClienteTravado> {
  const [cliente] = await query<ClienteTravado>(
    `select nome, uf, codigo_ibge, latitude, autorizacao_divulgacao, status_contrato from cliente_prefeitura where id = $1 for update`,
    [clienteId],
    c
  );
  if (!cliente) throw new Recusa(NAO_ENCONTRADO);
  return cliente;
}

async function evento(c: Executor, clienteId: string, tipo: "divulgacao_autorizada" | "divulgacao_revogada", hoje: string, equipeId: string, detalhe: string) {
  await query(
    `insert into cliente_evento_contrato (cliente_id, tipo, data_evento, detalhe, equipe_id, origem, criado_em) values ($1, $2, $3, $4, $5, 'painel', clock_timestamp())`,
    [clienteId, tipo, hoje, detalhe, equipeId],
    c
  );
}

async function executar(fn: (c: Executor) => Promise<ResultadoDivulgacao>, executor?: Executor): Promise<ResultadoDivulgacao> {
  try {
    return await (executor ? fn(executor) : withTransaction(fn));
  } catch (erro) {
    if (erro instanceof Recusa) return erro.resultado;
    const pg = erro as { code?: string; constraint?: string };
    if (pg?.code === "23505" && pg.constraint === "uq_cliente_prefeitura_codigo_ibge") {
      return { ok: false, motivo: "codigo_em_uso", erro: "Este código IBGE já está cadastrado em outro cliente." };
    }
    throw erro;
  }
}

/** Grava (ou limpa, com `codigo` null) o código IBGE e a posição. `executor` opcional: teste em transação desfeita. */
export function definirCodigoIbge(
  clienteId: string,
  codigo: string | null,
  posicao: { lat: number; lon: number } | null,
  executor?: Executor
): Promise<ResultadoDivulgacao> {
  return executar(async (c) => {
    const cliente = await travar(c, clienteId);
    if (cliente.autorizacao_divulgacao) {
      throw new Recusa({ ok: false, motivo: "transicao_invalida", erro: "Este cliente está autorizado no mapa público — revogue a autorização antes de alterar o código IBGE." });
    }
    await query(`update cliente_prefeitura set codigo_ibge = $1, latitude = $2, longitude = $3 where id = $4`, [
      codigo,
      codigo && posicao ? posicao.lat.toFixed(6) : null,
      codigo && posicao ? posicao.lon.toFixed(6) : null,
      clienteId
    ], c);
    return { ok: true, nome: cliente.nome, uf: cliente.uf };
  }, executor);
}

export function autorizarDivulgacao(clienteId: string, equipeId: string, hoje: string, executor?: Executor): Promise<ResultadoDivulgacao> {
  return executar(async (c) => {
    const cliente = await travar(c, clienteId);
    if (cliente.autorizacao_divulgacao) throw new Recusa({ ok: false, motivo: "transicao_invalida", erro: "Este cliente já está autorizado no mapa público." });
    // 16-B1: pré-contrato não vai ao mapa — a divulgação é uma cláusula do contrato ASSINADO.
    if (cliente.status_contrato === "aguardando_assinatura") {
      throw new Recusa({ ok: false, motivo: "transicao_invalida", erro: "Este cliente ainda aguarda a assinatura do contrato — a divulgação só pode ser autorizada depois da assinatura." });
    }
    if (!cliente.codigo_ibge || cliente.latitude === null) {
      throw new Recusa({ ok: false, motivo: "transicao_invalida", erro: "Para autorizar, o cliente precisa de código IBGE e posição (busque a posição antes)." });
    }
    await query(`update cliente_prefeitura set autorizacao_divulgacao = true, autorizacao_divulgacao_em = now(), autorizacao_divulgacao_por = $1 where id = $2`, [equipeId, clienteId], c);
    await evento(c, clienteId, "divulgacao_autorizada", hoje, equipeId, "Autorizado a aparecer no mapa público (nome, UF e posição aproximada).");
    return { ok: true, nome: cliente.nome, uf: cliente.uf };
  }, executor);
}

export function revogarDivulgacao(clienteId: string, equipeId: string, hoje: string, executor?: Executor): Promise<ResultadoDivulgacao> {
  return executar(async (c) => {
    const cliente = await travar(c, clienteId);
    if (!cliente.autorizacao_divulgacao) throw new Recusa({ ok: false, motivo: "transicao_invalida", erro: "Este cliente não está autorizado no mapa público." });
    await query(`update cliente_prefeitura set autorizacao_divulgacao = false, autorizacao_divulgacao_em = null, autorizacao_divulgacao_por = null where id = $1`, [clienteId], c);
    await evento(c, clienteId, "divulgacao_revogada", hoje, equipeId, "Autorização de divulgação revogada — saiu do mapa público.");
    return { ok: true, nome: cliente.nome, uf: cliente.uf };
  }, executor);
}
