// Escrita e leitura de notas fiscais (rodada 08) — aplica as regras PURAS
// de lib/estadoNota.ts dentro de transações. Usado pela tela de Notas
// (app/api/notas/**) E pela Fila de Checagem (POST /api/notas/[id]/verificar):
// as duas telas passam pelas mesmas funções, nenhuma regra de transição
// existe duas vezes.
//
// TRANSAÇÃO + LOCK: toda ação lê a nota com `select ... for update` ANTES
// de validar a transição — duas ações simultâneas na mesma nota (dois
// cliques em "pagar", checagem e tela de Notas ao mesmo tempo) são
// serializadas, e a segunda já vê o estado deixado pela primeira (409 em
// vez de pagamento em dobro). Update da nota + evento no histórico +
// resolução de alertas (+ evento_verificacao, quando vem da checagem)
// entram juntos ou não entram.

import { query, withTransaction, type Executor } from "./db";
import { centavosParaNumeric } from "./dinheiro";
import {
  LIMIAR_ATRASO_CRITICO_DIAS,
  PRAZO_PAGAMENTO_DIAS,
  faseDaNota,
  situacaoDaNota,
  statusAposAcao,
  validarDataEvento,
  validarTransicao,
  type AcaoNota,
  type SituacaoNota
} from "./estadoNota";
import type { EventoNota, NotaListada, TipoEventoNota } from "./tipos";

export type { EventoNota, NotaListada };

// --- Listagem ---------------------------------------------------------------

export const COLUNAS_ORDENACAO = ["data_emissao", "competencia", "valor", "numero_nf", "situacao", "cliente"] as const;
export type ColunaOrdenacao = (typeof COLUNAS_ORDENACAO)[number];

export interface FiltrosNotas {
  situacao?: SituacaoNota;
  clienteId?: string;
  competencia?: string; // "aaaa-mm-01"
  busca?: string; // trecho do número da NF
  ordenar: ColunaOrdenacao;
  direcao: "asc" | "desc";
  pagina: number;
  porPagina: number;
}


/**
 * Situação em SQL — PRECISA dar o mesmo resultado de
 * lib/estadoNota.ts#situacaoDaNota (é o que permite filtrar e paginar no
 * servidor sem trazer todas as notas pra memória). Limiares vêm das MESMAS
 * constantes de lib/prazos.ts, como parâmetro. A equivalência das duas é
 * conferida contra Postgres real em lib/notasServico.integration.test.ts,
 * uma nota por situação, incluindo as bordas (0, 1, 59 e 60 dias de atraso).
 */
const SQL_SITUACAO = (pHoje: string, pCritico: string, pPrazo: string) => `
  case
    when nf.status = 'cancelada' then 'cancelada'
    when nf.data_pagamento is not null or nf.status = 'paga' then 'paga'
    when nf.data_atesto is null then 'aguardando_atesto'
    when ${pHoje}::date - coalesce(nf.data_limite_pagamento, nf.data_atesto + ${pPrazo}::int) >= ${pCritico}::int then 'atraso_critico'
    when ${pHoje}::date - coalesce(nf.data_limite_pagamento, nf.data_atesto + ${pPrazo}::int) > 0 then 'vencida'
    else 'atestada'
  end`;

const ORDEM_SQL: Record<ColunaOrdenacao, string> = {
  data_emissao: "nf.data_emissao",
  competencia: "nf.competencia",
  valor: "nf.valor",
  numero_nf: "nf.numero_nf",
  situacao: "situacao",
  cliente: "c.nome"
};

/** `%`, `_` e `\` do texto de busca viram literais no ILIKE. */
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listarNotas(filtros: FiltrosNotas, hoje: string): Promise<{ notas: NotaListada[]; total: number }> {
  const params: unknown[] = [hoje, LIMIAR_ATRASO_CRITICO_DIAS, PRAZO_PAGAMENTO_DIAS];
  const condicoes: string[] = [];
  const situacaoSql = SQL_SITUACAO("$1", "$2", "$3");

  if (filtros.situacao) {
    params.push(filtros.situacao);
    condicoes.push(`(${situacaoSql}) = $${params.length}`);
  }
  if (filtros.clienteId) {
    params.push(filtros.clienteId);
    condicoes.push(`nf.cliente_id = $${params.length}`);
  }
  if (filtros.competencia) {
    params.push(filtros.competencia);
    condicoes.push(`nf.competencia = $${params.length}::date`);
  }
  if (filtros.busca) {
    params.push(`%${escaparLike(filtros.busca)}%`);
    condicoes.push(`nf.numero_nf ilike $${params.length} escape '\\'`);
  }

  params.push(filtros.porPagina, (filtros.pagina - 1) * filtros.porPagina);
  const pLimite = `$${params.length - 1}`;
  const pOffset = `$${params.length}`;
  // Coluna e direção vêm de listas fechadas (COLUNAS_ORDENACAO / asc|desc), nunca do texto da requisição.
  const direcao = filtros.direcao === "asc" ? "asc" : "desc";
  const ordem = `${ORDEM_SQL[filtros.ordenar]} ${direcao} nulls last, nf.created_at desc, nf.id`;

  const linhas = await query<NotaListada & { total: number }>(
    `select
       nf.id, nf.cliente_id, nf.numero_nf, nf.valor, nf.competencia, nf.data_emissao, nf.data_atesto,
       nf.data_limite_pagamento, nf.data_pagamento, nf.status, nf.motivo_cancelamento, nf.cancelado_em,
       nf.arquivo_pdf_nome,
       (select v.versao from nota_fiscal_arquivo_versao v where v.chave = nf.arquivo_pdf_chave) as arquivo_pdf_versao_atual,
       json_build_object('id', c.id, 'nome', c.nome, 'uf', c.uf, 'sistema_portal', c.sistema_portal, 'portal_url', c.portal_url) as cliente,
       ${situacaoSql} as situacao,
       count(*) over ()::int as total
     from nota_fiscal nf
     join cliente_prefeitura c on c.id = nf.cliente_id
     ${condicoes.length ? `where ${condicoes.join(" and ")}` : ""}
     order by ${ordem}
     limit ${pLimite} offset ${pOffset}`,
    params
  );

  const total = linhas[0]?.total ?? (filtros.pagina > 1 ? await contarNotas(situacaoSql, condicoes, params.slice(0, -2)) : 0);
  const notas = linhas.map((linha) => {
    const nota: Partial<NotaListada & { total: number }> = { ...linha };
    delete nota.total; // `total` (count(*) over()) é da página, não de cada nota
    return nota as NotaListada;
  });
  return { notas, total };
}

// Página além do fim devolve zero linhas — sem a janela count(*) over(), o
// total sai de um count separado (só nesse caso). A expressão de situação
// entra no select de dentro de propósito: é o que referencia $1..$3 (hoje
// e limiares) mesmo sem filtro de situação — parâmetro não referenciado
// faz o Postgres recusar a query ("could not determine data type").
async function contarNotas(situacaoSql: string, condicoes: string[], params: unknown[]): Promise<number> {
  const [{ total }] = await query<{ total: number }>(
    `select count(*)::int as total from (
       select ${situacaoSql} as situacao
       from nota_fiscal nf join cliente_prefeitura c on c.id = nf.cliente_id
       ${condicoes.length ? `where ${condicoes.join(" and ")}` : ""}
     ) filtradas`,
    params
  );
  return total;
}

// --- Criação ----------------------------------------------------------------

export interface DadosNovaNota {
  clienteId: string;
  competencia: string; // já normalizada (1º dia do mês)
  numeroNf: string | null;
  valorCentavos: number;
  dataEmissao: string;
}

export type ResultadoCriacao =
  | { ok: true; id: string }
  | { ok: false; motivo: "cliente_inexistente" }
  | { ok: false; motivo: "cliente_inativo"; statusContrato: string }
  | { ok: false; motivo: "numero_duplicado" };

class ClienteRecusado extends Error {
  constructor(readonly resultado: Exclude<ResultadoCriacao, { ok: true }>) {
    super("cliente recusado");
  }
}

export async function criarNota(dados: DadosNovaNota, feitoPor: string): Promise<ResultadoCriacao> {
  try {
    const id = await withTransaction(async (c) => {
      // `for share`: impede o cliente de mudar de status (suspender/encerrar) no meio desta criação.
      const clientes = await query<{ status_contrato: string }>(
        `select status_contrato from cliente_prefeitura where id = $1 for share`,
        [dados.clienteId],
        c
      );
      if (clientes.length === 0) throw new ClienteRecusado({ ok: false, motivo: "cliente_inexistente" });
      if (clientes[0].status_contrato !== "ativo") {
        throw new ClienteRecusado({ ok: false, motivo: "cliente_inativo", statusContrato: clientes[0].status_contrato });
      }

      const [nota] = await query<{ id: string; status: string }>(
        `insert into nota_fiscal (cliente_id, competencia, numero_nf, valor, data_emissao, status)
         values ($1, $2, $3, $4::numeric, $5, 'aguardando_atesto') returning id, status`,
        [dados.clienteId, dados.competencia, dados.numeroNf, centavosParaNumeric(dados.valorCentavos), dados.dataEmissao],
        c
      );
      await registrarEvento(c, { notaId: nota.id, tipo: "criacao", statusNovo: nota.status, feitoPor });
      return nota.id;
    });
    return { ok: true, id };
  } catch (erro) {
    if (erro instanceof ClienteRecusado) return erro.resultado;
    const pg = erro as { code?: string; constraint?: string };
    if (pg?.code === "23505" && pg.constraint === "uq_nota_fiscal_cliente_numero_nf") return { ok: false, motivo: "numero_duplicado" };
    throw erro;
  }
}

// --- Ações ------------------------------------------------------------------

type TipoEvento = TipoEventoNota;

const TIPO_EVENTO_DA_ACAO: Record<AcaoNota, TipoEvento> = {
  registrar_atesto: "atesto",
  registrar_pagamento: "pagamento",
  cancelar: "cancelamento",
  reabrir_pagamento: "reabertura_pagamento"
};

export interface DadosAcao {
  dataEvento?: string | null; // obrigatória pra atesto e pagamento
  motivo?: string | null; // obrigatório pra cancelar e reabrir (validado pela rota)
  /** Quando a ação vem da Fila de Checagem: grava também em evento_verificacao, na mesma transação. */
  verificacao?: { resultado: "atestada" | "paga"; observacao: string | null };
}

export type ResultadoAcao =
  | { ok: true; statusAnterior: SituacaoNota; statusNovo: SituacaoNota }
  | { ok: false; motivo: "nao_encontrada" }
  | { ok: false; motivo: "transicao_invalida" | "dados_invalidos"; erro: string };

interface NotaTravada {
  status: string;
  data_emissao: string;
  data_atesto: string | null;
  data_limite_pagamento: string | null;
  data_pagamento: string | null;
}

class AcaoRecusada extends Error {
  constructor(readonly resultado: Exclude<ResultadoAcao, { ok: true }>) {
    super("ação recusada");
  }
}

export async function executarAcaoNota(notaId: string, acao: AcaoNota, dados: DadosAcao, feitoPor: string, hoje: string): Promise<ResultadoAcao> {
  try {
    return await withTransaction(async (c) => {
      const [nota] = await query<NotaTravada>(
        `select status, data_emissao, data_atesto, data_limite_pagamento, data_pagamento from nota_fiscal where id = $1 for update`,
        [notaId],
        c
      );
      if (!nota) throw new AcaoRecusada({ ok: false, motivo: "nao_encontrada" });

      const transicao = validarTransicao(faseDaNota(nota), acao);
      if (!transicao.ok) throw new AcaoRecusada({ ok: false, motivo: "transicao_invalida", erro: transicao.erro });

      const dataEvento = dados.dataEvento ?? null;
      if (acao === "registrar_atesto" || acao === "registrar_pagamento") {
        const limites =
          acao === "registrar_atesto"
            ? { hoje, minima: nota.data_emissao, rotuloMinima: "data de emissão" }
            : { hoje, minima: nota.data_atesto!, rotuloMinima: "data do atesto" };
        const erroData = dataEvento ? validarDataEvento(dataEvento, limites) : "Informe a data.";
        if (erroData) throw new AcaoRecusada({ ok: false, motivo: "dados_invalidos", erro: erroData });
      }

      const statusAnterior = situacaoDaNota(nota, hoje);
      const statusNovo = statusAposAcao(nota, acao, dataEvento, hoje);
      const motivo = dados.motivo ?? null;

      switch (acao) {
        case "registrar_atesto":
          // data_limite_pagamento: o trigger trg_calcular_data_limite (0001) calcula atesto + 30.
          await query(`update nota_fiscal set data_atesto = $1, status = $2 where id = $3`, [dataEvento, statusNovo, notaId], c);
          await query(
            `update alerta_cobranca set status = 'resolvido', resolvido_em = now()
             where nota_fiscal_id = $1 and tipo = 'sem_atesto_prolongado' and status <> 'resolvido'`,
            [notaId],
            c
          );
          break;
        case "registrar_pagamento":
          await query(`update nota_fiscal set data_pagamento = $1, status = 'paga' where id = $2`, [dataEvento, notaId], c);
          await resolverTodosOsAlertas(c, notaId);
          break;
        case "cancelar":
          await query(
            `update nota_fiscal set status = 'cancelada', motivo_cancelamento = $1, cancelado_em = now(), cancelado_por = $2 where id = $3`,
            [motivo, feitoPor, notaId],
            c
          );
          await resolverTodosOsAlertas(c, notaId);
          break;
        case "reabrir_pagamento":
          // Alertas resolvidos não voltam: o job diário recria os que ainda fizerem sentido.
          await query(`update nota_fiscal set data_pagamento = null, status = $1 where id = $2`, [statusNovo, notaId], c);
          break;
      }

      if (dados.verificacao) {
        await query(
          `insert into evento_verificacao (nota_fiscal_id, resultado, observacao, verificado_por) values ($1, $2, $3, $4)`,
          [notaId, dados.verificacao.resultado, dados.verificacao.observacao, feitoPor],
          c
        );
      }

      await registrarEvento(c, {
        notaId,
        tipo: TIPO_EVENTO_DA_ACAO[acao],
        statusAnterior,
        statusNovo,
        // Reabertura guarda a data do pagamento DESFEITO (é o fato registrado).
        dataEvento: acao === "reabrir_pagamento" ? nota.data_pagamento : dataEvento,
        motivo,
        observacao: dados.verificacao ? `Registrado pela Fila de Checagem${dados.verificacao.observacao ? `: ${dados.verificacao.observacao}` : "."}` : null,
        feitoPor
      });

      return { ok: true as const, statusAnterior, statusNovo };
    });
  } catch (erro) {
    if (erro instanceof AcaoRecusada) return erro.resultado;
    throw erro;
  }
}

/**
 * Checagem no portal SEM mudança de estado ("ainda sem atesto", "erro de
 * acesso ao portal"): evento_verificacao + evento no histórico, na mesma
 * transação. Nota inexistente → false.
 */
export async function registrarVerificacaoSemMudanca(
  notaId: string,
  resultado: "sem_atesto_ainda" | "erro_acesso_portal",
  observacao: string | null,
  feitoPor: string,
  hoje: string
): Promise<boolean> {
  return withTransaction(async (c) => {
    const [nota] = await query<NotaTravada>(
      `select status, data_emissao, data_atesto, data_limite_pagamento, data_pagamento from nota_fiscal where id = $1 for update`,
      [notaId],
      c
    );
    if (!nota) return false;
    await query(`insert into evento_verificacao (nota_fiscal_id, resultado, observacao, verificado_por) values ($1, $2, $3, $4)`, [notaId, resultado, observacao, feitoPor], c);
    const situacao = situacaoDaNota(nota, hoje);
    await registrarEvento(c, {
      notaId,
      tipo: "verificacao_portal",
      statusAnterior: situacao,
      statusNovo: situacao,
      observacao: resultado === "sem_atesto_ainda" ? `Ainda sem atesto no portal${observacao ? `: ${observacao}` : "."}` : `Erro de acesso ao portal${observacao ? `: ${observacao}` : "."}`,
      feitoPor
    });
    return true;
  });
}

async function resolverTodosOsAlertas(c: Executor, notaId: string): Promise<void> {
  await query(`update alerta_cobranca set status = 'resolvido', resolvido_em = now() where nota_fiscal_id = $1 and status <> 'resolvido'`, [notaId], c);
}

async function registrarEvento(
  c: Executor,
  e: {
    notaId: string;
    tipo: TipoEvento;
    statusAnterior?: string | null;
    statusNovo?: string | null;
    dataEvento?: string | null;
    motivo?: string | null;
    observacao?: string | null;
    feitoPor: string | null;
  }
): Promise<void> {
  await query(
    `insert into nota_fiscal_evento (nota_fiscal_id, tipo, status_anterior, status_novo, data_evento, motivo, observacao, feito_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [e.notaId, e.tipo, e.statusAnterior ?? null, e.statusNovo ?? null, e.dataEvento ?? null, e.motivo ?? null, e.observacao ?? null, e.feitoPor],
    c
  );
}

// --- Histórico --------------------------------------------------------------


/** Histórico da nota, do mais antigo pro mais recente. null se a nota não existe. Da pessoa, só o nome. */
export async function listarEventos(notaId: string): Promise<EventoNota[] | null> {
  const existe = await query(`select 1 from nota_fiscal where id = $1`, [notaId]);
  if (existe.length === 0) return null;
  return query<EventoNota>(
    `select e.id, e.tipo, e.status_anterior, e.status_novo, e.data_evento, e.motivo, e.observacao, q.nome as feito_por_nome, e.feito_em
     from nota_fiscal_evento e
     left join equipe_nexaigen q on q.id = e.feito_por
     where e.nota_fiscal_id = $1
     order by e.feito_em, e.id`,
    [notaId]
  );
}
