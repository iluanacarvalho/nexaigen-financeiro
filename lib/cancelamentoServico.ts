// Escrita do cancelamento de contrato (rodada 12-A) — aplica as regras
// PURAS de lib/cancelamentoContrato.ts dentro de transações. Usado pela
// tela de Clientes (app/api/clientes/[id]/cancelamento), pela integração
// com o Educa (app/api/integracao/clientes/[municipioIdExterno]/cancelamento)
// e pelo job diário (encerramento no fim do aviso) — nenhuma regra de
// transição existe duas vezes.
//
// TRANSAÇÃO + LOCK: toda ação lê o cliente com `select ... for update`
// antes de validar — dois registros simultâneos (dois cliques, a tela e o
// Educa ao mesmo tempo) são serializados e o segundo já vê o estado
// deixado pelo primeiro. Update do cliente + evento de auditoria
// (cliente_evento_contrato) entram juntos ou não entram.
//
// IDEMPOTÊNCIA: repetir a MESMA ação sobre o estado que ela própria deixou
// (mesmo pedido já registrado, retratação já feita, contrato já encerrado)
// devolve `{ ok: true, mudou: false }` SEM gravar evento novo. A
// integração responde 200 a isso (retry do Educa); a tela de Clientes
// responde 409 (quem clicou precisa saber que nada mudou).

import { query, withTransaction, type Executor } from "./db";
import {
  avisoPrevioVencido,
  competenciaNotaFinal,
  formatarDataBr,
  validarPedido,
  validarRetratacao,
  type StatusContrato
} from "./cancelamentoContrato";

export type OrigemEventoContrato = "painel" | "educa" | "sistema";
/**
 * Os tipos de evento que dizem respeito ao CONTRATO. Desde a rodada 15-B a
 * mesma trilha (cliente_evento_contrato) também guarda a divulgação no mapa
 * público ('divulgacao_autorizada'/'divulgacao_revogada') — toda lógica de
 * contrato (idempotência da retratação, relatório de aviso prévio) filtra
 * por esta lista, senão um evento de divulgação posterior "esconderia" o
 * último evento de contrato.
 */
export const TIPOS_EVENTO_CONTRATO = ["cancelamento_registrado", "cancelamento_retratado", "contrato_encerrado"] as const;
export type TipoEventoContrato = (typeof TIPOS_EVENTO_CONTRATO)[number];

export interface AutorContrato {
  origem: OrigemEventoContrato;
  /** Quem da equipe (painel); null pra integração e job diário. */
  equipeId: string | null;
}

export type RecusaContrato =
  | { ok: false; motivo: "nao_encontrado" }
  | { ok: false; motivo: "transicao_invalida" | "dados_invalidos"; erro: string };

export type ResultadoContrato =
  | { ok: true; mudou: boolean; clienteId: string; statusContrato: StatusContrato; pedidoEm: string | null; terminoEm: string | null }
  | RecusaContrato;

interface ClienteTravado {
  id: string;
  status_contrato: StatusContrato;
  data_inicio_contrato: string;
  cancelamento_pedido_em: string | null;
  cancelamento_termino_em: string | null;
}

class Recusada extends Error {
  constructor(readonly resultado: RecusaContrato) {
    super("ação de contrato recusada");
  }
}

async function travarCliente(c: Executor, clienteId: string): Promise<ClienteTravado> {
  const [cliente] = await query<ClienteTravado>(
    `select id, status_contrato, data_inicio_contrato, cancelamento_pedido_em, cancelamento_termino_em
     from cliente_prefeitura where id = $1 for update`,
    [clienteId],
    c
  );
  if (!cliente) throw new Recusada({ ok: false, motivo: "nao_encontrado" });
  return cliente;
}

async function registrarEvento(
  c: Executor,
  e: { clienteId: string; tipo: TipoEventoContrato; dataEvento: string; detalhe: string | null; autor: AutorContrato }
): Promise<void> {
  // clock_timestamp(), não o default now(): now() é o INÍCIO da transação — dois eventos da mesma transação
  // (registrar + encerrar na hora) ficariam com o mesmo criado_em e a ordem da trilha seria ambígua.
  await query(
    `insert into cliente_evento_contrato (cliente_id, tipo, data_evento, detalhe, equipe_id, origem, criado_em)
     values ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [e.clienteId, e.tipo, e.dataEvento, e.detalhe, e.autor.equipeId, e.autor.origem],
    c
  );
}

function resultado(cliente: Pick<ClienteTravado, "id" | "status_contrato" | "cancelamento_pedido_em" | "cancelamento_termino_em">, mudou: boolean): ResultadoContrato {
  return {
    ok: true,
    mudou,
    clienteId: cliente.id,
    statusContrato: cliente.status_contrato,
    pedidoEm: cliente.cancelamento_pedido_em,
    terminoEm: cliente.cancelamento_termino_em
  };
}

async function executar(fn: (c: Executor) => Promise<ResultadoContrato>): Promise<ResultadoContrato> {
  try {
    return await withTransaction(fn);
  } catch (erro) {
    if (erro instanceof Recusada) return erro.resultado;
    throw erro;
  }
}

async function encerrar(c: Executor, cliente: ClienteTravado, dataEvento: string, detalhe: string | null, autor: AutorContrato): Promise<ResultadoContrato> {
  await query(`update cliente_prefeitura set status_contrato = 'encerrado' where id = $1`, [cliente.id], c);
  await registrarEvento(c, { clienteId: cliente.id, tipo: "contrato_encerrado", dataEvento, detalhe, autor });
  return resultado({ ...cliente, status_contrato: "encerrado" }, true);
}

/**
 * Registra o cancelamento (ofício recebido em `dataPedido`): contrato
 * 'ativo' → 'em_aviso_previo', término = pedido + 30. Se o ofício foi
 * recebido há mais de 30 dias (o término já passou), o contrato é
 * encerrado NA MESMA transação — os dois eventos ficam na trilha.
 */
export async function registrarCancelamento(
  clienteId: string,
  dados: { dataPedido: string; motivo: string | null },
  autor: AutorContrato,
  hoje: string
): Promise<ResultadoContrato> {
  return executar(async (c) => {
    const cliente = await travarCliente(c, clienteId);
    // Repetição do MESMO registro (retry): nada muda, nenhum evento novo.
    if ((cliente.status_contrato === "em_aviso_previo" || cliente.status_contrato === "encerrado") && cliente.cancelamento_pedido_em === dados.dataPedido) {
      return resultado(cliente, false);
    }
    const validacao = validarPedido({ dataPedido: dados.dataPedido, hoje, dataInicioContrato: cliente.data_inicio_contrato, statusContrato: cliente.status_contrato });
    if (!validacao.ok) throw new Recusada(validacao);

    await query(
      `update cliente_prefeitura
       set status_contrato = 'em_aviso_previo', cancelamento_pedido_em = $1, cancelamento_termino_em = $2, cancelamento_motivo = $3
       where id = $4`,
      [dados.dataPedido, validacao.termino, dados.motivo, cliente.id],
      c
    );
    await registrarEvento(c, { clienteId: cliente.id, tipo: "cancelamento_registrado", dataEvento: dados.dataPedido, detalhe: dados.motivo, autor });
    const emAviso: ClienteTravado = { ...cliente, status_contrato: "em_aviso_previo", cancelamento_pedido_em: dados.dataPedido, cancelamento_termino_em: validacao.termino };

    if (avisoPrevioVencido(validacao.termino, hoje)) {
      return encerrar(c, emAviso, validacao.termino, `Ofício recebido em ${formatarDataBr(dados.dataPedido)} — o aviso prévio já tinha terminado no registro.`, autor);
    }
    return resultado(emAviso, true);
  });
}

/** Retrata o cancelamento: 'em_aviso_previo' → 'ativo' (até a data de término), limpando pedido/término/motivo. */
export async function retratarCancelamento(clienteId: string, autor: AutorContrato, hoje: string): Promise<ResultadoContrato> {
  return executar(async (c) => {
    const cliente = await travarCliente(c, clienteId);
    if (cliente.status_contrato === "ativo") {
      // Repetição da retratação (retry): o último evento do contrato já é a própria retratação.
      const [ultimo] = await query<{ tipo: TipoEventoContrato }>(
        `select tipo from cliente_evento_contrato where cliente_id = $1 and tipo = any($2::text[]) order by criado_em desc, id desc limit 1`,
        [cliente.id, TIPOS_EVENTO_CONTRATO],
        c
      );
      if (ultimo?.tipo === "cancelamento_retratado") return resultado(cliente, false);
    }
    const validacao = validarRetratacao({ statusContrato: cliente.status_contrato, termino: cliente.cancelamento_termino_em, hoje });
    if (!validacao.ok) throw new Recusada(validacao);

    await query(
      `update cliente_prefeitura
       set status_contrato = 'ativo', cancelamento_pedido_em = null, cancelamento_termino_em = null, cancelamento_motivo = null
       where id = $1`,
      [cliente.id],
      c
    );
    await registrarEvento(c, {
      clienteId: cliente.id,
      tipo: "cancelamento_retratado",
      dataEvento: hoje,
      detalhe: `Cancelamento retratado (ofício de ${formatarDataBr(cliente.cancelamento_pedido_em!)}, término previsto em ${formatarDataBr(cliente.cancelamento_termino_em!)}).`,
      autor
    });
    return resultado({ ...cliente, status_contrato: "ativo", cancelamento_pedido_em: null, cancelamento_termino_em: null }, true);
  });
}

/**
 * Encerra o contrato. Sem `imediato`: só um aviso prévio cujo término JÁ
 * PASSOU (data do evento = término). Com `imediato`: encerra agora
 * (data do evento = hoje), de qualquer status não encerrado — o
 * pedido/término de um aviso em andamento ficam registrados. Já
 * encerrado → nada muda (idempotente).
 */
export async function encerrarContrato(
  clienteId: string,
  dados: { imediato: boolean; motivo: string | null },
  autor: AutorContrato,
  hoje: string
): Promise<ResultadoContrato> {
  return executar(async (c) => {
    const cliente = await travarCliente(c, clienteId);
    if (cliente.status_contrato === "encerrado") return resultado(cliente, false);

    const termino = cliente.cancelamento_termino_em;
    if (cliente.status_contrato === "em_aviso_previo" && termino && avisoPrevioVencido(termino, hoje)) {
      return encerrar(c, cliente, termino, dados.motivo ?? `Fim do aviso prévio (término em ${formatarDataBr(termino)}).`, autor);
    }
    if (dados.imediato) {
      return encerrar(c, cliente, hoje, dados.motivo ?? "Encerramento imediato.", autor);
    }
    throw new Recusada({
      ok: false,
      motivo: "transicao_invalida",
      erro:
        cliente.status_contrato === "em_aviso_previo" && termino
          ? `O aviso prévio só termina em ${formatarDataBr(termino)} — o contrato segue até lá (para encerrar antes, envie imediato: true).`
          : "Este contrato não está em aviso prévio — para encerrá-lo agora, envie imediato: true."
    });
  });
}

export interface ResumoEncerramento {
  encerrados: number;
  falhas: number;
}

/**
 * Job diário: contratos em aviso prévio cujo término passou (`termino <
 * hoje` — o dia do término ainda é de contrato) viram 'encerrado'. Cada
 * cliente na SUA transação: a falha de um não impede os outros (nem o
 * resto do job). Devolve contagens; quem chama decide o alerta.
 */
export async function encerrarAvisosVencidos(hoje: string): Promise<ResumoEncerramento> {
  const vencidos = await query<{ id: string }>(
    `select id from cliente_prefeitura where status_contrato = 'em_aviso_previo' and cancelamento_termino_em < $1::date order by cancelamento_termino_em, id`,
    [hoje]
  );
  const resumo: ResumoEncerramento = { encerrados: 0, falhas: 0 };
  for (const { id } of vencidos) {
    try {
      const r = await encerrarContrato(id, { imediato: false, motivo: null }, { origem: "sistema", equipeId: null }, hoje);
      if (r.ok && r.mudou) resumo.encerrados += 1;
    } catch (erro) {
      // Nunca o erro cru (pode ecoar dados da linha) — só o código do pg.
      const codigo = (erro as { code?: string } | null)?.code ?? "desconhecido";
      console.error(`[verificar-prazos] falha ao encerrar contrato em aviso prévio — código pg: ${codigo}.`);
      resumo.falhas += 1;
    }
  }
  return resumo;
}

/**
 * Pra cada cliente com término de aviso prévio registrado, diz se a nota
 * FINAL (mensalidade não cancelada da competência do último período) já
 * existe. Uma query só pra todos os clientes (sem N+1); a competência é
 * calculada pela MESMA função pura que a criação de nota usa
 * (lib/cancelamentoContrato.ts#competenciaNotaFinal) — a regra não é
 * reescrita em SQL.
 */
export async function clientesComNotaFinalEmitida(
  clientes: { id: string; data_inicio_contrato: string; cancelamento_termino_em: string | null }[]
): Promise<Set<string>> {
  const comTermino = clientes.filter((c) => c.cancelamento_termino_em !== null);
  if (comTermino.length === 0) return new Set();
  const linhas = await query<{ cliente_id: string }>(
    `select distinct n.cliente_id
     from nota_fiscal n
     join unnest($1::uuid[], $2::date[]) as alvo(cliente_id, competencia)
       on alvo.cliente_id = n.cliente_id and alvo.competencia = n.competencia
     where n.tipo = 'mensalidade' and n.status <> 'cancelada'`,
    [comTermino.map((c) => c.id), comTermino.map((c) => competenciaNotaFinal(c.data_inicio_contrato, c.cancelamento_termino_em!))]
  );
  return new Set(linhas.map((l) => l.cliente_id));
}

/** Cliente vinculado a um município do Educa (municipio_id_externo) — null se não há. */
export async function clientePorMunicipio(municipioIdExterno: string): Promise<string | null> {
  const [linha] = await query<{ id: string }>(`select id from cliente_prefeitura where municipio_id_externo = $1`, [municipioIdExterno]);
  return linha?.id ?? null;
}
