// Leitura do CRM (rodada 16-A). VISIBILIDADE NO SQL, nunca só na tela:
//   - lead COMPLETO (listagem, detalhe, funil, resumo, exportação): toda
//     consulta passa por `condicaoEscopo` — admin vê todos; vendas SÓ os
//     leads em que é o vendedor_id. Lead de colega simplesmente não volta
//     (a rota responde 404 — não 403, pra não permitir enumeração);
//   - CONSULTA MÍNIMA (consultarLeads — "Já existe esse lead?"): função
//     PRÓPRIA, com as colunas escritas uma a uma, devolvendo de QUALQUER
//     lead só municipio_nome, uf, etapa, nome do vendedor e o dia da última
//     atividade (+ id, meu_lead e pode_pedir pro botão "Pedir este lead").
//     Nunca contato, valor, plano, origem, motivo, notas, histórico ou
//     próxima ação. O teste de integração confere as chaves EXATAS.
//
// "Última atividade" = a interação mais recente de TIPOS_ATIVIDADE
// (lib/crm.ts — contato registrado, mudança de etapa, reabertura), ou a
// criação do lead se não houver nenhuma; "parado" e o pedido de
// reatribuição comparam o DIA dela em America/Sao_Paulo. A mesma regra das
// funções puras (lib/crm.ts) — a equivalência é conferida no teste de
// integração nas bordas (14/15 e 60/61 dias).

import { consultasJuntas, query, type Executor } from "./db";
import {
  DIAS_PARADO,
  ETAPAS,
  ETAPAS_ABERTAS,
  TIPOS_ATIVIDADE,
  acaoVencida,
  calcularTaxasDeAvanco,
  clienteEncerrado,
  clientesDoMunicipio,
  dataDoEncerramento,
  corteDeDias,
  diaEmSaoPaulo,
  diasSemAtividade,
  leadParado,
  podePedirLead,
  type ClienteDoMunicipio,
  type Etapa,
  type TaxaAvanco
} from "./crm";
import { nomeDeMunicipioNormalizado } from "./ibge";
import { PLANOS } from "./planos";
import { planoEfetivo, type PlanoEfetivo, type PlanoFiltro } from "./territorio";

/** Quem está lendo. admin = vê todos os leads; senão, só os seus (vendedor_id). */
export interface EscopoCrm {
  equipeId: string;
  admin: boolean;
}

/** Condição SQL do escopo, com o parâmetro já empurrado em `params`. ÚNICO lugar que decide "de quem é o lead". */
export function condicaoEscopo(escopo: EscopoCrm, params: unknown[], alias = "l"): string {
  if (escopo.admin) return "true";
  params.push(escopo.equipeId);
  return `${alias}.vendedor_id = $${params.length}::uuid`;
}

/** Expressão SQL da última atividade de `l` (instante). `pAtividade` = parâmetro com TIPOS_ATIVIDADE. */
const ULTIMA_ATIVIDADE = (pAtividade: string) =>
  `greatest(l.criado_em, (select max(i.em) from lead_interacao i where i.lead_id = l.id and i.tipo = any(${pAtividade}::text[])))`;

const DIA_SP = (expr: string) => `((${expr}) at time zone 'America/Sao_Paulo')::date`;

/** Coluna do município da base (0016) do lead `l` — SÓ pelo código IBGE (rodada 16-A3: lead sem código não tem município; "vincular município"). */
const MUNICIPIO_DA_BASE = (coluna: string) => `(select mb.${coluna} from municipio_base mb where mb.codigo_ibge = l.codigo_ibge)`;

/**
 * Plano SUGERIDO pela população em SQL — gerado das faixas de lib/planos.ts
 * (fonte única; nenhum número escrito à mão aqui). Equivalência com
 * planoSugeridoPorPopulacao conferida no teste de integração nas bordas.
 */
const PLANO_SUGERIDO_SQL = (populacao: string) =>
  `(case ${PLANOS.map((pl) => `when ${populacao} >= ${pl.populacaoMinima}${pl.populacaoMaxima === null ? "" : ` and ${populacao} <= ${pl.populacaoMaxima}`} then '${pl.id}'`).join(" ")} end)`;

/** Filtro de plano efetivo do lead (mesma regra de lib/territorio.ts#casaPlano). */
function condicaoPlano(planos: PlanoFiltro[], ignorarSugerido: boolean, p: (v: unknown) => string): string {
  const considerado = ignorarSugerido ? "l.plano_interesse" : `coalesce(l.plano_interesse, ${PLANO_SUGERIDO_SQL("base.populacao_efetiva")})`;
  if (planos.length === 0) return `${considerado} is not null`;
  const ids = planos.filter((x) => x !== "sem_plano");
  const partes = [`${considerado} = any(${p(ids)}::text[])`];
  if (planos.includes("sem_plano")) partes.push(`${considerado} is null`);
  return `(${partes.join(" or ")})`;
}

// --- Lead completo ------------------------------------------------------------------

export interface LeadCompleto {
  id: string;
  municipio_nome: string;
  uf: string;
  codigo_ibge: string | null;
  populacao: number | null;
  plano_interesse: string | null;
  valor_mensal_estimado_centavos: number | null;
  contato_nome: string | null;
  contato_cargo: string | null;
  contato_email: string | null;
  contato_telefone: string | null;
  origem: string;
  etapa: Etapa;
  vendedor_id: string;
  vendedor_nome: string;
  motivo_perda: string | null;
  detalhe_perda: string | null;
  proxima_acao_em: string | null;
  proxima_acao_descricao: string | null;
  versao: number;
  criado_em: string;
  atualizado_em: string;
  ultima_atividade_em: string;
}

export interface LeadListado extends LeadCompleto {
  dias_sem_atividade: number;
  parado: boolean;
  acao_vencida: boolean;
  /**
   * EX-CLIENTE (rodada 16-A1, campo DERIVADO — nenhuma coluna): o município
   * já foi cliente e o contrato está encerrado hoje (lib/crm.ts#clienteEncerrado).
   */
  ex_cliente: boolean;
  /** Data do encerramento do ex-cliente (null: encerrado antes da trilha de eventos, sem data registrada). */
  ex_cliente_encerrado_em: string | null;
  /**
   * PLANO EFETIVO do lead (rodada 16-A2, lib/territorio.ts#planoEfetivo):
   * o plano de interesse; sem ele, o sugerido pela população (a do lead, ou
   * a da base de municípios); sem população, "sem plano definido".
   */
  plano_efetivo: PlanoEfetivo;
  /** População usada pro plano sugerido: a do lead, senão a da base de municípios (null sem nenhuma). */
  populacao_considerada: number | null;
}

type Anotacoes = "ex_cliente" | "ex_cliente_encerrado_em" | "plano_efetivo" | "populacao_considerada";

const COLUNAS_LEAD = `l.id, l.municipio_nome, l.uf, l.codigo_ibge, l.populacao, l.plano_interesse, l.valor_mensal_estimado_centavos,
  l.contato_nome, l.contato_cargo, l.contato_email, l.contato_telefone, l.origem, l.etapa, l.vendedor_id, q.nome as vendedor_nome,
  l.motivo_perda, l.detalhe_perda, l.proxima_acao_em, l.proxima_acao_descricao, l.versao, l.criado_em, l.atualizado_em`;

function comSelos(l: LeadCompleto, hoje: string): Omit<LeadListado, Anotacoes> {
  return {
    ...l,
    dias_sem_atividade: diasSemAtividade(l.ultima_atividade_em, hoje),
    parado: leadParado(l.etapa, l.ultima_atividade_em, hoje),
    acao_vencida: acaoVencida(l.etapa, l.proxima_acao_em, hoje)
  };
}

export const ORDENACOES_LEAD = ["atualizado", "proxima_acao", "valor", "municipio", "ultima_atividade", "etapa"] as const;
export type OrdenacaoLead = (typeof ORDENACOES_LEAD)[number];

const ORDEM_SQL: Record<OrdenacaoLead, string> = {
  atualizado: "atualizado_em",
  proxima_acao: "proxima_acao_em",
  valor: "valor_mensal_estimado_centavos",
  municipio: "municipio_nome",
  ultima_atividade: "ultima_atividade_em",
  etapa: `array_position(array[${ETAPAS.map((e) => `'${e}'`).join(",")}]::text[], etapa)`
};

export interface FiltrosLeads {
  etapa?: Etapa;
  /** Só admin (a rota recusa pra vendas). */
  vendedorId?: string;
  uf?: string;
  origem?: string;
  busca?: string;
  parados?: boolean;
  vencidas?: boolean;
  /** Só abertos (funil). */
  somenteAbertos?: boolean;
  /** Plano efetivo (rodada 16-A2): ids e/ou "sem_plano". */
  planos?: PlanoFiltro[];
  /** Só plano de interesse conta (ignora o sugerido pela população). */
  ignorarSugerido?: boolean;
  /** Município membro da entidade (ativa). */
  entidadeId?: string;
  /** Só leads SEM município vinculado (codigo_ibge nulo) — rodada 16-A3. */
  semMunicipio?: boolean;
  ordenar: OrdenacaoLead;
  direcao: "asc" | "desc";
  pagina: number;
  porPagina: number;
}

export async function listarLeads(f: FiltrosLeads, escopo: EscopoCrm, hoje: string, executor?: Executor): Promise<{ leads: LeadListado[]; total: number }> {
  const params: unknown[] = [TIPOS_ATIVIDADE];
  const condicoes = [condicaoEscopo(escopo, params, "l")];
  const p = (valor: unknown) => {
    params.push(valor);
    return `$${params.length}`;
  };
  if (f.etapa) condicoes.push(`l.etapa = ${p(f.etapa)}`);
  if (f.vendedorId) condicoes.push(`l.vendedor_id = ${p(f.vendedorId)}::uuid`);
  if (f.uf) condicoes.push(`l.uf = ${p(f.uf)}`);
  if (f.origem) condicoes.push(`l.origem = ${p(f.origem)}`);
  if (f.busca) condicoes.push(`l.nome_busca like ${p(`%${nomeDeMunicipioNormalizado(f.busca).replace(/[\\%_]/g, (c) => `\\${c}`)}%`)} escape '\\'`);
  if (f.somenteAbertos || f.parados || f.vencidas) condicoes.push(`l.etapa = any(${p(ETAPAS_ABERTAS)}::text[])`);
  if (f.parados) condicoes.push(`${DIA_SP("base.ultima_atividade_em")} < ${p(corteDeDias(hoje, DIAS_PARADO))}::date`);
  if (f.vencidas) condicoes.push(`l.proxima_acao_em < ${p(hoje)}::date`);
  if ((f.planos && f.planos.length > 0) || f.ignorarSugerido) condicoes.push(condicaoPlano(f.planos ?? [], !!f.ignorarSugerido, p));
  if (f.semMunicipio) condicoes.push(`l.codigo_ibge is null`);
  if (f.entidadeId) {
    condicoes.push(`exists (select 1 from entidade_membro em join entidade_intermunicipal e on e.id = em.entidade_id and e.ativo
      where em.entidade_id = ${p(f.entidadeId)}::uuid and em.codigo_ibge = base.codigo_municipio)`);
  }

  const direcao = f.direcao === "asc" ? "asc" : "desc";
  const pLimite = p(f.porPagina);
  const pOffset = p((f.pagina - 1) * f.porPagina);
  const linhas = await query<LeadCompleto & { total: number }>(
    `select * from (
       select ${COLUNAS_LEAD}, base.ultima_atividade_em, count(*) over ()::int as total
       from lead l
       join equipe_nexaigen q on q.id = l.vendedor_id
       cross join lateral (select ${ULTIMA_ATIVIDADE("$1")} as ultima_atividade_em, ${MUNICIPIO_DA_BASE("codigo_ibge")} as codigo_municipio,
                           coalesce(l.populacao, ${MUNICIPIO_DA_BASE("populacao")}) as populacao_efetiva) base
       where ${condicoes.join(" and ")}
     ) x
     order by ${ORDEM_SQL[f.ordenar]} ${direcao} nulls last, atualizado_em desc, id
     limit ${pLimite} offset ${pOffset}`,
    params,
    executor
  );
  const leads = linhas.map((linha) => {
    const lead: Partial<LeadCompleto & { total: number }> = { ...linha };
    delete lead.total; // `total` (count(*) over()) é da página, não do lead
    return comSelos(lead as LeadCompleto, hoje);
  });
  return { total: linhas[0]?.total ?? 0, leads: await anotarExClientes(leads, hoje, executor) };
}

// --- Funil ------------------------------------------------------------------------------

/** Cartões por coluna do funil. Os TOTAIS por etapa vêm de agregação SQL (obterResumoCrm), nunca destes cartões. */
export const CARTOES_POR_ETAPA = 50;

/**
 * Cartões do funil: até `limite` por etapa (abertas e perdido), numa query só
 * (row_number() por etapa), no ESCOPO de quem lê. Ordem dentro da coluna:
 * abertas — ação vencida primeiro, depois os mais antigos sem atividade;
 * perdido — os perdidos mais recentes primeiro. Quem mostra compara com o
 * total da etapa (resumo) e oferece "Ver todos os N desta etapa": nunca
 * menos do que existe sem aviso.
 */
export async function listarFunil(escopo: EscopoCrm, hoje: string, limite = CARTOES_POR_ETAPA, executor?: Executor): Promise<Record<Etapa, LeadListado[]>> {
  const params: unknown[] = [TIPOS_ATIVIDADE, hoje, limite];
  const linhas = await query<LeadCompleto & { posicao: number }>(
    `select * from (
       select ${COLUNAS_LEAD}, base.ultima_atividade_em,
              row_number() over (
                partition by l.etapa
                order by
                  case when l.etapa = 'perdido' then 0 when l.proxima_acao_em < $2::date then 0 else 1 end,
                  case when l.etapa = 'perdido' then -extract(epoch from l.atualizado_em) else extract(epoch from base.ultima_atividade_em) end,
                  l.id
              )::int as posicao
       from lead l
       join equipe_nexaigen q on q.id = l.vendedor_id
       cross join lateral (select ${ULTIMA_ATIVIDADE("$1")} as ultima_atividade_em) base
       where l.etapa <> 'ganho' and ${condicaoEscopo(escopo, params, "l")}
     ) x
     where posicao <= $3
     order by etapa, posicao`,
    params,
    executor
  );
  const leads = await anotarExClientes(
    linhas.map((linha) => {
      const lead: Partial<LeadCompleto & { posicao: number }> = { ...linha };
      delete lead.posicao;
      return comSelos(lead as LeadCompleto, hoje);
    }),
    hoje,
    executor
  );
  const funil = Object.fromEntries(ETAPAS.map((e) => [e, [] as LeadListado[]])) as Record<Etapa, LeadListado[]>;
  for (const l of leads) funil[l.etapa].push(l);
  return funil;
}

export interface InteracaoLead {
  id: string;
  tipo: string;
  texto: string | null;
  etapa_anterior: string | null;
  etapa_nova: string | null;
  autor_nome: string;
  em: string;
}

/** Lead completo + histórico (mais recente primeiro). null se não existe OU não está no escopo (a rota responde 404 nos dois). */
export async function obterLead(id: string, escopo: EscopoCrm, hoje: string, executor?: Executor): Promise<(LeadListado & { historico: InteracaoLead[] }) | null> {
  const params: unknown[] = [TIPOS_ATIVIDADE, id];
  const [lead] = await query<LeadCompleto>(
    `select ${COLUNAS_LEAD}, ${ULTIMA_ATIVIDADE("$1")} as ultima_atividade_em
     from lead l join equipe_nexaigen q on q.id = l.vendedor_id
     where l.id = $2::uuid and ${condicaoEscopo(escopo, params, "l")}`,
    params,
    executor
  );
  if (!lead) return null;
  const historico = await query<InteracaoLead>(
    `select i.id, i.tipo, i.texto, i.etapa_anterior, i.etapa_nova, a.nome as autor_nome, i.em
     from lead_interacao i join equipe_nexaigen a on a.id = i.autor_id
     where i.lead_id = $1 order by i.em desc, i.id desc`,
    [id],
    executor
  );
  const [anotado] = await anotarExClientes([comSelos(lead, hoje)], hoje, executor);
  return { ...anotado, historico };
}

// --- Clientes do município (duplicidade e "ex-cliente") --------------------------------

/**
 * Clientes (cliente_prefeitura) que PODEM ser do mesmo município de algum
 * dos leads: mesma UF ou mesmo código IBGE. Uma query só, sem N+1; o
 * casamento por nome normalizado é feito em TS (lib/crm.ts#clientesDoMunicipio),
 * porque o banco não tem a normalização sem acento. `encerrado_em` = último
 * evento 'contrato_encerrado' da trilha (0011).
 */
export async function lerClientesDosMunicipios(ufs: string[], codigos: string[], executor?: Executor): Promise<ClienteDoMunicipio[]> {
  if (ufs.length === 0 && codigos.length === 0) return [];
  return query<ClienteDoMunicipio>(
    `select c.nome, c.uf, c.codigo_ibge, c.status_contrato, c.cancelamento_termino_em,
            (select max(e.data_evento) from cliente_evento_contrato e where e.cliente_id = c.id and e.tipo = 'contrato_encerrado') as encerrado_em
     from cliente_prefeitura c
     where c.uf = any($1::text[]) or c.codigo_ibge = any($2::text[])`,
    [ufs, codigos],
    executor
  );
}

/** População da base de municípios (0016) pros leads — SÓ pelo código IBGE (rodada 16-A3). */
async function populacaoDaBase(leads: Pick<LeadCompleto, "codigo_ibge">[], executor?: Executor): Promise<(l: Pick<LeadCompleto, "codigo_ibge">) => number | null> {
  const codigos = [...new Set(leads.map((l) => l.codigo_ibge).filter((c): c is string => c !== null))];
  if (codigos.length === 0) return () => null;
  const linhas = await query<{ codigo_ibge: string; populacao: number | null }>(`select codigo_ibge, populacao from municipio_base where codigo_ibge = any($1::text[])`, [codigos], executor);
  const porCodigo = new Map(linhas.map((m) => [m.codigo_ibge, m.populacao]));
  return (l) => (l.codigo_ibge !== null ? (porCodigo.get(l.codigo_ibge) ?? null) : null);
}

/**
 * Anota os campos DERIVADOS dos leads (nenhuma coluna): "ex-cliente" (todos
 * os clientes do município estão encerrados hoje, e há pelo menos um) e o
 * plano efetivo (rodada 16-A2).
 */
async function anotarExClientes<T extends Omit<LeadListado, Anotacoes>>(leads: T[], hoje: string, executor?: Executor): Promise<(T & Pick<LeadListado, Anotacoes>)[]> {
  const [clientes, populacao] = await consultasJuntas(executor, [
    () => lerClientesDosMunicipios([...new Set(leads.map((l) => l.uf))], [...new Set(leads.map((l) => l.codigo_ibge).filter((c): c is string => c !== null))], executor),
    () => populacaoDaBase(leads, executor)
  ]);
  return leads.map((l) => {
    const doMunicipio = clientesDoMunicipio(clientes, { uf: l.uf, nomeBusca: nomeDeMunicipioNormalizado(l.municipio_nome), codigoIbge: l.codigo_ibge });
    const exCliente = doMunicipio.length > 0 && doMunicipio.every((c) => clienteEncerrado(c, hoje));
    const datas = doMunicipio.map(dataDoEncerramento).filter((d): d is string => d !== null).sort();
    const populacaoConsiderada = l.populacao ?? populacao(l);
    return {
      ...l,
      ex_cliente: exCliente,
      ex_cliente_encerrado_em: exCliente ? (datas.at(-1) ?? null) : null,
      plano_efetivo: planoEfetivo({ planoContratado: null, planoInteresse: l.plano_interesse, populacao: populacaoConsiderada }),
      populacao_considerada: populacaoConsiderada
    };
  });
}

// --- Consulta mínima ("Já existe esse lead?") -----------------------------------------

/** EXATAMENTE estas chaves — nada de contato, valor, plano, origem, motivo, notas, histórico ou próxima ação. */
export interface LeadConsulta {
  id: string;
  municipio_nome: string;
  uf: string;
  etapa: string;
  vendedor_nome: string;
  /** Dia (America/Sao_Paulo) da última atividade — "aaaa-mm-dd", sem a hora. */
  ultima_atividade_em: string;
  meu_lead: boolean;
  /** Lead de colega, aberto e parado há mais de 60 dias: mostra "Pedir este lead". */
  pode_pedir: boolean;
}

export interface FiltrosConsulta {
  busca?: string;
  uf?: string;
  codigoIbge?: string;
  pagina: number;
  porPagina: number;
}

/**
 * Busca em TODOS os leads (de qualquer vendedor) e devolve SÓ os campos
 * mínimos. Colunas escritas uma a uma — nunca `select *` nem o lead
 * completo filtrado depois.
 */
export async function consultarLeads(f: FiltrosConsulta, escopo: EscopoCrm, hoje: string, executor?: Executor): Promise<{ leads: LeadConsulta[]; total: number }> {
  const params: unknown[] = [TIPOS_ATIVIDADE, escopo.equipeId];
  const condicoes: string[] = [];
  const p = (valor: unknown) => {
    params.push(valor);
    return `$${params.length}`;
  };
  if (f.busca) condicoes.push(`l.nome_busca like ${p(`%${nomeDeMunicipioNormalizado(f.busca).replace(/[\\%_]/g, (c) => `\\${c}`)}%`)} escape '\\'`);
  if (f.uf) condicoes.push(`l.uf = ${p(f.uf)}`);
  if (f.codigoIbge) condicoes.push(`l.codigo_ibge = ${p(f.codigoIbge)}`);
  const pLimite = p(f.porPagina);
  const pOffset = p((f.pagina - 1) * f.porPagina);
  const linhas = await query<{ id: string; municipio_nome: string; uf: string; etapa: string; vendedor_nome: string; ultima_atividade_em: string; meu_lead: boolean; total: number }>(
    `select l.id, l.municipio_nome, l.uf, l.etapa, q.nome as vendedor_nome,
            ${ULTIMA_ATIVIDADE("$1")} as ultima_atividade_em,
            (l.vendedor_id = $2::uuid) as meu_lead,
            count(*) over ()::int as total
     from lead l join equipe_nexaigen q on q.id = l.vendedor_id
     where ${condicoes.length ? condicoes.join(" and ") : "false"}
     order by l.uf, l.nome_busca, l.criado_em desc, l.id
     limit ${pLimite} offset ${pOffset}`,
    params,
    executor
  );
  return {
    total: linhas[0]?.total ?? 0,
    // Objeto NOVO, chave por chave: nada que a query trouxer a mais escapa.
    leads: linhas.map((l) => ({
      id: l.id,
      municipio_nome: l.municipio_nome,
      uf: l.uf,
      etapa: l.etapa,
      vendedor_nome: l.vendedor_nome,
      ultima_atividade_em: diaEmSaoPaulo(l.ultima_atividade_em),
      meu_lead: l.meu_lead,
      pode_pedir: !l.meu_lead && podePedirLead(l.etapa, l.ultima_atividade_em, hoje)
    }))
  };
}

// --- Resumo do funil ---------------------------------------------------------------------

export interface ResumoCrm {
  hoje: string;
  abertos: { quantidade: number; valorCentavos: number };
  porEtapa: { etapa: Etapa; quantidade: number; valorCentavos: number }[];
  /** Leads que ESTÃO ganhos e cujo aceite foi registrado neste mês (dia em SP) — 16-B1. */
  ganhosNoMes: number;
  perdidosNoMes: number;
  taxasDeAvanco: TaxaAvanco[];
  /** Próximas ações vencidas ou de hoje dos leads EM QUE QUEM LÊ É O VENDEDOR (mesmo admin: "minhas"). */
  minhasAcoes: { id: string; municipio_nome: string; uf: string; etapa: Etapa; proxima_acao_em: string; proxima_acao_descricao: string | null }[];
  /** Só admin: carga por vendedor (leads abertos e valor). */
  cargaPorVendedor: { vendedor_id: string; vendedor_nome: string; abertos: number; valorCentavos: number }[] | null;
  /** Só admin: pedidos de reatribuição pendentes. */
  pedidosPendentes: PedidoPendente[] | null;
  /** Só admin: leads SEM município vinculado (sem código IBGE) — rodada 16-A3, aviso "vincular município". */
  leadsSemMunicipio: number | null;
}

export interface PedidoPendente {
  id: string;
  lead_id: string;
  municipio_nome: string;
  uf: string;
  dono_nome: string;
  solicitante_nome: string;
  em: string;
}

export async function obterResumoCrm(escopo: EscopoCrm, hoje: string, executor?: Executor): Promise<ResumoCrm> {
  const pEsc: unknown[] = [];
  const escopoSql = condicaoEscopo(escopo, pEsc, "l");
  const mes = hoje.slice(0, 7);

  const [porEtapa, perdidos, ganhos, alcancadas, acoes] = await consultasJuntas(executor, [
    () => query<{ etapa: Etapa; quantidade: number; valor: number }>(
      `select l.etapa, count(*)::int as quantidade, coalesce(sum(l.valor_mensal_estimado_centavos), 0)::bigint as valor
       from lead l where ${escopoSql} group by l.etapa`,
      pEsc,
      executor
    ),
    // Perdidos no mês: leads que ESTÃO perdidos e cuja perda foi registrada neste mês (dia em SP).
    () => query<{ n: number }>(
      `select count(*)::int as n from lead l
       where ${escopoSql} and l.etapa = 'perdido'
         and exists (select 1 from lead_interacao i where i.lead_id = l.id and i.etapa_nova = 'perdido'
                     and to_char((i.em at time zone 'America/Sao_Paulo'), 'YYYY-MM') = $${pEsc.length + 1})`,
      [...pEsc, mes],
      executor
    ),
    // Ganhos no mês (16-B1): leads que ESTÃO ganhos e cujo aceite (mudança pra 'ganho') foi registrado neste mês (dia em SP).
    () => query<{ n: number }>(
      `select count(*)::int as n from lead l
       where ${escopoSql} and l.etapa = 'ganho'
         and exists (select 1 from lead_interacao i where i.lead_id = l.id and i.etapa_nova = 'ganho'
                     and to_char((i.em at time zone 'America/Sao_Paulo'), 'YYYY-MM') = $${pEsc.length + 1})`,
      [...pEsc, mes],
      executor
    ),
    () => query<{ etapa: string; alcancadas: string[] | null }>(
      `select l.etapa, (select array_agg(i.etapa_nova) from lead_interacao i where i.lead_id = l.id and i.etapa_nova is not null) as alcancadas
       from lead l where ${escopoSql}`,
      pEsc,
      executor
    ),
    () => query<ResumoCrm["minhasAcoes"][number]>(
      `select l.id, l.municipio_nome, l.uf, l.etapa, l.proxima_acao_em, l.proxima_acao_descricao
       from lead l
       where l.vendedor_id = $1::uuid and l.etapa = any($2::text[]) and l.proxima_acao_em <= $3::date
       order by l.proxima_acao_em, l.municipio_nome`,
      [escopo.equipeId, ETAPAS_ABERTAS, hoje],
      executor
    )
  ]);

  const mapaEtapa = new Map(porEtapa.map((r) => [r.etapa, r]));
  const linhasEtapa = ETAPAS.map((etapa) => ({ etapa, quantidade: mapaEtapa.get(etapa)?.quantidade ?? 0, valorCentavos: Number(mapaEtapa.get(etapa)?.valor ?? 0) }));
  const abertas = linhasEtapa.filter((e) => (ETAPAS_ABERTAS as readonly string[]).includes(e.etapa));

  let cargaPorVendedor: ResumoCrm["cargaPorVendedor"] = null;
  let pedidosPendentes: ResumoCrm["pedidosPendentes"] = null;
  let leadsSemMunicipio: number | null = null;
  if (escopo.admin) {
    const [carga, pedidos, semMunicipio] = await consultasJuntas(executor, [
      () => query<{ vendedor_id: string; vendedor_nome: string; abertos: number; valor: number }>(
        `select l.vendedor_id, q.nome as vendedor_nome, count(*)::int as abertos, coalesce(sum(l.valor_mensal_estimado_centavos), 0)::bigint as valor
         from lead l join equipe_nexaigen q on q.id = l.vendedor_id
         where l.etapa = any($1::text[]) group by l.vendedor_id, q.nome order by abertos desc, q.nome`,
        [ETAPAS_ABERTAS],
        executor
      ).then((rows) => rows.map((r) => ({ vendedor_id: r.vendedor_id, vendedor_nome: r.vendedor_nome, abertos: r.abertos, valorCentavos: Number(r.valor) }))),
      () => listarPedidosPendentes(executor),
      () => query<{ n: number }>(`select count(*)::int as n from lead where codigo_ibge is null and etapa <> 'ganho'`, [], executor)
    ]);
    cargaPorVendedor = carga;
    pedidosPendentes = pedidos;
    leadsSemMunicipio = semMunicipio[0].n;
  }

  return {
    hoje,
    abertos: { quantidade: abertas.reduce((s, e) => s + e.quantidade, 0), valorCentavos: abertas.reduce((s, e) => s + e.valorCentavos, 0) },
    porEtapa: linhasEtapa,
    ganhosNoMes: ganhos[0].n,
    perdidosNoMes: perdidos[0].n,
    taxasDeAvanco: calcularTaxasDeAvanco(alcancadas.map((r) => ["novo", r.etapa, ...(r.alcancadas ?? [])])),
    minhasAcoes: acoes,
    cargaPorVendedor,
    pedidosPendentes,
    leadsSemMunicipio
  };
}

export async function listarPedidosPendentes(executor?: Executor): Promise<PedidoPendente[]> {
  return query<PedidoPendente>(
    `select p.id, p.lead_id, l.municipio_nome, l.uf, d.nome as dono_nome, s.nome as solicitante_nome, p.em
     from lead_pedido_reatribuicao p
     join lead l on l.id = p.lead_id
     join equipe_nexaigen d on d.id = l.vendedor_id
     join equipe_nexaigen s on s.id = p.solicitante_id
     where p.resolvido_em is null
     order by p.em`,
    [],
    executor
  );
}

/** Quem pode ser vendedor de lead: ativo, papel vendas ou admin (mesma regra de lib/crmServico.ts#validarVendedor). Só id e nome. */
export async function listarVendedores(executor?: Executor): Promise<{ id: string; nome: string }[]> {
  return query<{ id: string; nome: string }>(`select id, nome from equipe_nexaigen where ativo and papel in ('vendas', 'admin') order by nome`, [], executor);
}
