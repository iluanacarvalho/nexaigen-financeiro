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

import { query, type Executor } from "./db";
import {
  DIAS_PARADO,
  ETAPAS,
  ETAPAS_ABERTAS,
  TIPOS_ATIVIDADE,
  acaoVencida,
  calcularTaxasDeAvanco,
  corteDeDias,
  diaEmSaoPaulo,
  diasSemAtividade,
  leadParado,
  podePedirLead,
  type Etapa,
  type TaxaAvanco
} from "./crm";
import { nomeDeMunicipioNormalizado } from "./ibge";

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
}

const COLUNAS_LEAD = `l.id, l.municipio_nome, l.uf, l.codigo_ibge, l.populacao, l.plano_interesse, l.valor_mensal_estimado_centavos,
  l.contato_nome, l.contato_cargo, l.contato_email, l.contato_telefone, l.origem, l.etapa, l.vendedor_id, q.nome as vendedor_nome,
  l.motivo_perda, l.detalhe_perda, l.proxima_acao_em, l.proxima_acao_descricao, l.versao, l.criado_em, l.atualizado_em`;

function comSelos(l: LeadCompleto, hoje: string): LeadListado {
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

  const direcao = f.direcao === "asc" ? "asc" : "desc";
  const pLimite = p(f.porPagina);
  const pOffset = p((f.pagina - 1) * f.porPagina);
  const linhas = await query<LeadCompleto & { total: number }>(
    `select * from (
       select ${COLUNAS_LEAD}, base.ultima_atividade_em, count(*) over ()::int as total
       from lead l
       join equipe_nexaigen q on q.id = l.vendedor_id
       cross join lateral (select ${ULTIMA_ATIVIDADE("$1")} as ultima_atividade_em) base
       where ${condicoes.join(" and ")}
     ) x
     order by ${ORDEM_SQL[f.ordenar]} ${direcao} nulls last, atualizado_em desc, id
     limit ${pLimite} offset ${pOffset}`,
    params,
    executor
  );
  return {
    total: linhas[0]?.total ?? 0,
    leads: linhas.map((linha) => {
      const lead: Partial<LeadCompleto & { total: number }> = { ...linha };
      delete lead.total; // `total` (count(*) over()) é da página, não do lead
      return comSelos(lead as LeadCompleto, hoje);
    })
  };
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
  return { ...comSelos(lead, hoje), historico };
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
  /** null até a rodada 16-B (não existe fechamento ainda) — a tela mostra "—". */
  ganhosNoMes: null;
  perdidosNoMes: number;
  taxasDeAvanco: TaxaAvanco[];
  /** Próximas ações vencidas ou de hoje dos leads EM QUE QUEM LÊ É O VENDEDOR (mesmo admin: "minhas"). */
  minhasAcoes: { id: string; municipio_nome: string; uf: string; etapa: Etapa; proxima_acao_em: string; proxima_acao_descricao: string | null }[];
  /** Só admin: carga por vendedor (leads abertos e valor). */
  cargaPorVendedor: { vendedor_id: string; vendedor_nome: string; abertos: number; valorCentavos: number }[] | null;
  /** Só admin: pedidos de reatribuição pendentes. */
  pedidosPendentes: PedidoPendente[] | null;
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

  const [porEtapa, perdidos, alcancadas, acoes] = await Promise.all([
    query<{ etapa: Etapa; quantidade: number; valor: number }>(
      `select l.etapa, count(*)::int as quantidade, coalesce(sum(l.valor_mensal_estimado_centavos), 0)::bigint as valor
       from lead l where ${escopoSql} group by l.etapa`,
      pEsc,
      executor
    ),
    // Perdidos no mês: leads que ESTÃO perdidos e cuja perda foi registrada neste mês (dia em SP).
    query<{ n: number }>(
      `select count(*)::int as n from lead l
       where ${escopoSql} and l.etapa = 'perdido'
         and exists (select 1 from lead_interacao i where i.lead_id = l.id and i.etapa_nova = 'perdido'
                     and to_char((i.em at time zone 'America/Sao_Paulo'), 'YYYY-MM') = $${pEsc.length + 1})`,
      [...pEsc, mes],
      executor
    ),
    query<{ etapa: string; alcancadas: string[] | null }>(
      `select l.etapa, (select array_agg(i.etapa_nova) from lead_interacao i where i.lead_id = l.id and i.etapa_nova is not null) as alcancadas
       from lead l where ${escopoSql}`,
      pEsc,
      executor
    ),
    query<ResumoCrm["minhasAcoes"][number]>(
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
  if (escopo.admin) {
    [cargaPorVendedor, pedidosPendentes] = await Promise.all([
      query<{ vendedor_id: string; vendedor_nome: string; abertos: number; valor: number }>(
        `select l.vendedor_id, q.nome as vendedor_nome, count(*)::int as abertos, coalesce(sum(l.valor_mensal_estimado_centavos), 0)::bigint as valor
         from lead l join equipe_nexaigen q on q.id = l.vendedor_id
         where l.etapa = any($1::text[]) group by l.vendedor_id, q.nome order by abertos desc, q.nome`,
        [ETAPAS_ABERTAS],
        executor
      ).then((rows) => rows.map((r) => ({ vendedor_id: r.vendedor_id, vendedor_nome: r.vendedor_nome, abertos: r.abertos, valorCentavos: Number(r.valor) }))),
      listarPedidosPendentes(executor)
    ]);
  }

  return {
    hoje,
    abertos: { quantidade: abertas.reduce((s, e) => s + e.quantidade, 0), valorCentavos: abertas.reduce((s, e) => s + e.valorCentavos, 0) },
    porEtapa: linhasEtapa,
    ganhosNoMes: null,
    perdidosNoMes: perdidos[0].n,
    taxasDeAvanco: calcularTaxasDeAvanco(alcancadas.map((r) => ["novo", r.etapa, ...(r.alcancadas ?? [])])),
    minhasAcoes: acoes,
    cargaPorVendedor,
    pedidosPendentes
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
