// Leitura do Território e das entidades intermunicipais (rodada 16-A2).
//
// O que cada pessoa vê:
//   - ESTADOS: admin vê os 27; vendas só os LIBERADOS (estado_comercial).
//     Município de estado não liberado não volta pra vendas em NENHUMA
//     consulta daqui (Território, entidade, busca, etiquetas, lote);
//   - ENTIDADES: só as ativas (admin também vê as desativadas na lista,
//     marcadas) e, pra vendas, só as sem UF ou de UF liberada;
//   - LEAD DE COLEGA: as consultas trazem o lead pra calcular o status, mas
//     a linha é montada CHAVE A CHAVE por lib/territorio.ts#montarLinha —
//     pra vendas, lead de colega = só etapa e vendedor.
// Nenhuma consulta daqui lê contato, valor ou nota de lead ou de cliente.
//
// Sem N+1: cada leitura é um número fixo de consultas (municípios, clientes,
// leads, etiquetas), e as regras rodam em TS (lib/territorio.ts — uma função
// só pra todas as telas).

import { consultasJuntas, query, type Executor } from "./db";
import { TIPOS_ATIVIDADE } from "./crm";
import { UFS_BRASIL, type TipoEntidade } from "./entidades";
import { nomeDeMunicipioNormalizado, normalizarNome } from "./ibge";
import {
  clientesDoMunicipioBase,
  leadsDoMunicipioBase,
  montarLinha,
  situacaoComercial,
  type ClienteDoTerritorio,
  type EntidadeEtiqueta,
  type LeadDoTerritorio,
  type Leitor,
  type LinhaTerritorio,
  type MunicipioDoTerritorio
} from "./territorio";

// --- Estados -------------------------------------------------------------------------

/** UFs que quem lê pode ver no Território: admin todas; vendas só as liberadas. */
export async function ufsVisiveis(leitor: Leitor, executor?: Executor): Promise<string[]> {
  if (leitor.admin) return [...UFS_BRASIL];
  const linhas = await query<{ uf: string }>(`select uf from estado_comercial where liberado order by uf`, [], executor);
  return linhas.map((l) => l.uf);
}

/** UFs LIBERADAS pro comercial (a UF padrão do Território sai daqui). */
export async function ufsLiberadas(executor?: Executor): Promise<string[]> {
  const linhas = await query<{ uf: string }>(`select uf from estado_comercial where liberado order by uf`, [], executor);
  return linhas.map((l) => l.uf);
}

export interface EstadoComercial {
  uf: string;
  liberado: boolean;
  liberado_em: string | null;
  liberado_por_nome: string | null;
  municipios: number;
}

/** Os 27 estados com a situação comercial e quantos municípios já estão carregados (tela do admin). */
export async function listarEstados(executor?: Executor): Promise<EstadoComercial[]> {
  const linhas = await query<Omit<EstadoComercial, "uf"> & { uf: string }>(
    `select u.uf, coalesce(e.liberado, false) as liberado, e.liberado_em, q.nome as liberado_por_nome,
            (select count(*)::int from municipio_base m where m.uf = u.uf) as municipios
     from unnest($1::text[]) as u(uf)
     left join estado_comercial e on e.uf = u.uf
     left join equipe_nexaigen q on q.id = e.liberado_por
     order by u.uf`,
    [UFS_BRASIL],
    executor
  );
  return linhas;
}

// --- Linhas do Território --------------------------------------------------------------

export interface AlvoTerritorio {
  uf?: string;
  codigos?: string[];
  entidadeId?: string;
}

const COLUNAS_CLIENTE = `c.nome, c.uf, c.codigo_ibge, c.status_contrato, c.cancelamento_termino_em, c.plano, c.data_inicio_contrato,
  (select max(e.data_evento) from cliente_evento_contrato e where e.cliente_id = c.id and e.tipo = 'contrato_encerrado') as encerrado_em`;

async function lerMunicipios(alvo: AlvoTerritorio, ufs: string[], executor?: Executor): Promise<MunicipioDoTerritorio[]> {
  return query<MunicipioDoTerritorio>(
    `select m.codigo_ibge, m.nome, m.uf, m.populacao, m.populacao_ano, m.microrregiao, m.mesorregiao
     from municipio_base m
     where m.uf = any($1::text[])
       and ($2::text is null or m.uf = $2::text)
       and ($3::text[] is null or m.codigo_ibge = any($3::text[]))
       and ($4::uuid is null or exists (select 1 from entidade_membro em where em.entidade_id = $4::uuid and em.codigo_ibge = m.codigo_ibge))
     order by m.nome_busca, m.codigo_ibge`,
    [ufs, alvo.uf ?? null, alvo.codigos ?? null, alvo.entidadeId ?? null],
    executor
  );
}

async function lerClientes(codigos: string[], ufs: string[], executor?: Executor): Promise<ClienteDoTerritorio[]> {
  if (codigos.length === 0) return [];
  return query<ClienteDoTerritorio>(
    `select ${COLUNAS_CLIENTE} from cliente_prefeitura c
     where c.codigo_ibge = any($1::text[]) or (c.codigo_ibge is null and c.uf = any($2::text[]))`,
    [codigos, ufs],
    executor
  );
}

async function lerLeads(codigos: string[], ufs: string[], executor?: Executor): Promise<LeadDoTerritorio[]> {
  if (codigos.length === 0) return [];
  return query<LeadDoTerritorio>(
    `select l.id, l.municipio_nome, l.nome_busca, l.uf, l.codigo_ibge, l.etapa, l.vendedor_id, q.nome as vendedor_nome,
            l.plano_interesse, l.motivo_perda, l.proxima_acao_em, l.atualizado_em,
            greatest(l.criado_em, (select max(i.em) from lead_interacao i where i.lead_id = l.id and i.tipo = any($3::text[]))) as ultima_atividade_em
     from lead l join equipe_nexaigen q on q.id = l.vendedor_id
     where l.etapa <> 'ganho' and (l.codigo_ibge = any($1::text[]) or (l.codigo_ibge is null and l.uf = any($2::text[])))`,
    [codigos, ufs, TIPOS_ATIVIDADE],
    executor
  );
}

/**
 * Prefeituras CLIENTES (status "cliente" — mesma função de status) de cada
 * entidade, contando só os membros que quem lê pode ver. Pra etiqueta "N
 * prefeituras desta entidade já são clientes".
 */
async function clientesPorEntidade(entidadeIds: string[], ufs: string[], hoje: string, executor?: Executor): Promise<Map<string, number>> {
  const contagem = new Map<string, number>(entidadeIds.map((id) => [id, 0]));
  if (entidadeIds.length === 0) return contagem;
  const membros = await query<{ entidade_id: string; codigo_ibge: string; nome: string; uf: string }>(
    `select em.entidade_id, m.codigo_ibge, m.nome, m.uf from entidade_membro em join municipio_base m on m.codigo_ibge = em.codigo_ibge
     where em.entidade_id = any($1::uuid[]) and m.uf = any($2::text[])`,
    [entidadeIds, ufs],
    executor
  );
  const clientes = await lerClientes([...new Set(membros.map((m) => m.codigo_ibge))], [...new Set(membros.map((m) => m.uf))], executor);
  for (const m of membros) {
    if (situacaoComercial(clientesDoMunicipioBase(clientes, m), [], hoje).status === "cliente") contagem.set(m.entidade_id, (contagem.get(m.entidade_id) ?? 0) + 1);
  }
  return contagem;
}

/** Etiquetas de entidade (ativas e visíveis) por município, com a contagem de clientes de cada entidade. */
export async function etiquetasPorMunicipio(codigos: string[], leitor: Leitor, hoje: string, executor?: Executor, ufsDoLeitor?: string[]): Promise<Map<string, EntidadeEtiqueta[]>> {
  const ufs = ufsDoLeitor ?? (await ufsVisiveis(leitor, executor));
  const porCodigo = new Map<string, EntidadeEtiqueta[]>();
  if (codigos.length === 0) return porCodigo;
  const linhas = await query<{ codigo_ibge: string; id: string; nome: string; sigla: string | null }>(
    `select em.codigo_ibge, e.id, e.nome, e.sigla
     from entidade_membro em join entidade_intermunicipal e on e.id = em.entidade_id
     where em.codigo_ibge = any($1::text[]) and e.ativo and (e.uf is null or e.uf = any($2::text[]))
     order by e.nome, e.id`,
    [codigos, ufs],
    executor
  );
  const clientes = await clientesPorEntidade([...new Set(linhas.map((l) => l.id))], ufs, hoje, executor);
  for (const l of linhas) {
    const lista = porCodigo.get(l.codigo_ibge) ?? [];
    lista.push({ id: l.id, nome: l.nome, sigla: l.sigla, clientes: clientes.get(l.id) ?? 0 });
    porCodigo.set(l.codigo_ibge, lista);
  }
  return porCodigo;
}

/**
 * Linhas do Território (sem filtro de tela — quem chama filtra/ordena com
 * lib/territorio.ts). `alvo`: a UF, uma lista de códigos ou os membros de
 * uma entidade; sempre só dos estados que quem lê pode ver.
 */
export async function carregarLinhas(alvo: AlvoTerritorio, leitor: Leitor, hoje: string, executor?: Executor): Promise<LinhaTerritorio[]> {
  const ufs = await ufsVisiveis(leitor, executor);
  const municipios = await lerMunicipios(alvo, ufs, executor);
  const codigos = municipios.map((m) => m.codigo_ibge);
  const ufsDosMunicipios = [...new Set(municipios.map((m) => m.uf))];
  const [clientes, leads, etiquetas] = await consultasJuntas(executor, [
    () => lerClientes(codigos, ufsDosMunicipios, executor),
    () => lerLeads(codigos, ufsDosMunicipios, executor),
    () => etiquetasPorMunicipio(codigos, leitor, hoje, executor, ufs)
  ]);
  return municipios.map((m) => montarLinha(m, clientesDoMunicipioBase(clientes, m), leadsDoMunicipioBase(leads, m), etiquetas.get(m.codigo_ibge) ?? [], leitor, hoje));
}

/** Microrregiões da UF (opções do filtro). */
export async function listarMicrorregioes(uf: string, executor?: Executor): Promise<string[]> {
  const linhas = await query<{ microrregiao: string }>(`select distinct microrregiao from municipio_base where uf = $1 and microrregiao is not null order by microrregiao`, [uf], executor);
  return linhas.map((l) => l.microrregiao);
}

// --- Entidades ---------------------------------------------------------------------------

export interface EntidadeDetalhe {
  id: string;
  nome: string;
  sigla: string | null;
  tipo: TipoEntidade;
  uf: string | null;
  site: string | null;
  contato_nome: string | null;
  contato_email: string | null;
  contato_telefone: string | null;
  observacao: string | null;
  fonte_url: string;
  verificado_em: string;
  ativo: boolean;
  atualizado_em: string;
}

const COLUNAS_ENTIDADE = `e.id, e.nome, e.sigla, e.tipo, e.uf, e.site, e.contato_nome, e.contato_email, e.contato_telefone, e.observacao,
  e.fonte_url, e.verificado_em, e.ativo, e.atualizado_em`;

/** Condição de visibilidade da entidade: ativa (admin vê inativas só se pedir) e, pra vendas, sem UF ou de UF liberada. */
function condicaoEntidade(leitor: Leitor, ufs: string[], params: unknown[], incluirInativas: boolean): string {
  params.push(ufs);
  const uf = `(e.uf is null or e.uf = any($${params.length}::text[]))`;
  return incluirInativas && leitor.admin ? uf : `e.ativo and ${uf}`;
}

export interface EntidadeListada {
  id: string;
  nome: string;
  sigla: string | null;
  tipo: TipoEntidade;
  uf: string | null;
  ativo: boolean;
  verificado_em: string;
  municipios: number;
  clientes: number;
  em_negociacao: number;
  nao_abordados: number;
  /** clientes ÷ municípios (null sem municípios). */
  percentual_clientes: number | null;
}

/** Lista de entidades com as contagens (mesma função de status das outras telas). Busca por nome ou sigla (sem acento/caixa). */
export async function listarEntidades(leitor: Leitor, hoje: string, busca?: string, executor?: Executor): Promise<EntidadeListada[]> {
  const ufs = await ufsVisiveis(leitor, executor);
  const params: unknown[] = [];
  const entidades = await query<Pick<EntidadeListada, "id" | "nome" | "sigla" | "tipo" | "uf" | "ativo" | "verificado_em">>(
    `select e.id, e.nome, e.sigla, e.tipo, e.uf, e.ativo, e.verificado_em from entidade_intermunicipal e
     where ${condicaoEntidade(leitor, ufs, params, true)} order by e.ativo desc, e.nome`,
    params,
    executor
  );
  const termo = busca ? normalizarNome(busca) : "";
  const filtradas = termo ? entidades.filter((e) => normalizarNome(e.nome).includes(termo) || (e.sigla !== null && normalizarNome(e.sigla).includes(termo))) : entidades;
  if (filtradas.length === 0) return [];
  const membros = await query<{ entidade_id: string; codigo_ibge: string }>(
    `select em.entidade_id, em.codigo_ibge from entidade_membro em join municipio_base m on m.codigo_ibge = em.codigo_ibge
     where em.entidade_id = any($1::uuid[]) and m.uf = any($2::text[])`,
    [filtradas.map((e) => e.id), ufs],
    executor
  );
  const linhas = new Map((await carregarLinhas({ codigos: [...new Set(membros.map((m) => m.codigo_ibge))] }, leitor, hoje, executor)).map((l) => [l.codigo_ibge, l]));
  return filtradas.map((e) => {
    const daEntidade = membros.filter((m) => m.entidade_id === e.id).map((m) => linhas.get(m.codigo_ibge)).filter((l): l is LinhaTerritorio => l !== undefined);
    const n = (s: LinhaTerritorio["status"]) => daEntidade.filter((l) => l.status === s).length;
    const clientes = n("cliente");
    return {
      ...e,
      municipios: daEntidade.length,
      clientes,
      em_negociacao: n("em_negociacao"),
      nao_abordados: n("nao_abordado"),
      percentual_clientes: daEntidade.length === 0 ? null : Math.round((clientes / daEntidade.length) * 1000) / 10
    };
  });
}

/** Entidade (visível pra quem lê) + as linhas dos membros. null = não existe ou não é visível (a rota responde 404). */
export async function obterEntidade(id: string, leitor: Leitor, hoje: string, executor?: Executor): Promise<{ entidade: EntidadeDetalhe; linhas: LinhaTerritorio[] } | null> {
  const ufs = await ufsVisiveis(leitor, executor);
  const params: unknown[] = [id];
  const [entidade] = await query<EntidadeDetalhe>(
    `select ${COLUNAS_ENTIDADE} from entidade_intermunicipal e where e.id = $1::uuid and ${condicaoEntidade(leitor, ufs, params, true)}`,
    params,
    executor
  );
  if (!entidade) return null;
  return { entidade, linhas: await carregarLinhas({ entidadeId: id }, leitor, hoje, executor) };
}

/** Nome da entidade ATIVA e visível pra quem lê (null = não existe/não visível). */
export async function obterNomeEntidadeVisivel(id: string, leitor: Leitor, executor?: Executor): Promise<string | null> {
  const ufs = await ufsVisiveis(leitor, executor);
  const params: unknown[] = [id];
  const [e] = await query<{ nome: string }>(`select e.nome from entidade_intermunicipal e where e.id = $1::uuid and ${condicaoEntidade(leitor, ufs, params, false)}`, params, executor);
  return e?.nome ?? null;
}

/** Ids de entidades ATIVAS e visíveis (pra sanear filtro salvo / de URL). */
export async function entidadesAtivasVisiveis(ids: string[], leitor: Leitor, executor?: Executor): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const ufs = await ufsVisiveis(leitor, executor);
  const params: unknown[] = [ids];
  const linhas = await query<{ id: string }>(`select e.id from entidade_intermunicipal e where e.id = any($1::uuid[]) and ${condicaoEntidade(leitor, ufs, params, false)}`, params, executor);
  return new Set(linhas.map((l) => l.id));
}

/** Entidades ativas visíveis (id e nome) — opções do filtro "Entidade". */
export async function opcoesDeEntidade(leitor: Leitor, uf?: string, executor?: Executor): Promise<{ id: string; nome: string; sigla: string | null }[]> {
  const ufs = await ufsVisiveis(leitor, executor);
  const params: unknown[] = [];
  const cond = condicaoEntidade(leitor, ufs, params, false);
  params.push(uf ?? null);
  return query(`select e.id, e.nome, e.sigla from entidade_intermunicipal e where ${cond} and ($${params.length}::text is null or e.uf is null or e.uf = $${params.length}::text) order by e.nome`, params, executor);
}

// --- Busca -------------------------------------------------------------------------------

export interface MunicipioEncontrado {
  codigo_ibge: string;
  nome: string;
  uf: string;
  /** Dado público do IBGE (preenche o lead escolhido na base — rodada 16-A3). */
  populacao: number | null;
}

/** Município por nome (sem acento/caixa) ou código, só nos estados visíveis. */
export async function buscarMunicipios(busca: string, leitor: Leitor, uf?: string, limite = 10, executor?: Executor): Promise<MunicipioEncontrado[]> {
  const ufs = await ufsVisiveis(leitor, executor);
  const termo = nomeDeMunicipioNormalizado(busca).replace(/[\\%_]/g, (c) => `\\${c}`);
  return query<MunicipioEncontrado>(
    `select codigo_ibge, nome, uf, populacao from municipio_base
     where uf = any($1::text[]) and ($2::text is null or uf = $2::text)
       and (codigo_ibge = $3 or nome_busca like $4 escape '\\')
     order by (nome_busca = $5) desc, (nome_busca like $6 escape '\\') desc, nome_busca, uf
     limit $7`,
    [ufs, uf ?? null, busca.trim(), `%${termo}%`, termo, `${termo}%`, limite],
    executor
  );
}

/** Busca global do CRM: entidades (nome/sigla) e municípios. */
export async function buscarNoCrm(busca: string, leitor: Leitor, executor?: Executor): Promise<{ entidades: { id: string; nome: string; sigla: string | null; uf: string | null }[]; municipios: MunicipioEncontrado[] }> {
  const ufs = await ufsVisiveis(leitor, executor);
  const params: unknown[] = [];
  const todas = await query<{ id: string; nome: string; sigla: string | null; uf: string | null }>(
    `select e.id, e.nome, e.sigla, e.uf from entidade_intermunicipal e where ${condicaoEntidade(leitor, ufs, params, false)} order by e.nome`,
    params,
    executor
  );
  const termo = normalizarNome(busca);
  const entidades = todas.filter((e) => normalizarNome(e.nome).includes(termo) || (e.sigla !== null && normalizarNome(e.sigla) === termo)).slice(0, 8);
  return { entidades, municipios: await buscarMunicipios(busca, leitor, undefined, 8, executor) };
}

/**
 * Nomes das entidades (ativas) do município de cada lead — coluna "Entidades"
 * da exportação da carteira (só admin). SÓ pelo código IBGE (rodada 16-A3):
 * lead sem código não tem município vinculado. Uma consulta.
 */
export async function nomesDeEntidadesPorLead(leads: { id: string; codigo_ibge: string | null }[], executor?: Executor): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  const comCodigo = leads.filter((l): l is { id: string; codigo_ibge: string } => l.codigo_ibge !== null);
  if (comCodigo.length === 0) return mapa;
  const linhas = await query<{ lead_id: string; nome: string; sigla: string | null }>(
    `select x.lead_id, e.nome, e.sigla
     from unnest($1::uuid[], $2::text[]) as x(lead_id, codigo_ibge)
     join entidade_membro em on em.codigo_ibge = x.codigo_ibge
     join entidade_intermunicipal e on e.id = em.entidade_id and e.ativo
     order by e.nome`,
    [comCodigo.map((l) => l.id), comCodigo.map((l) => l.codigo_ibge)],
    executor
  );
  for (const l of linhas) mapa.set(l.lead_id, [...(mapa.get(l.lead_id) ?? []), l.sigla ? `${l.nome} (${l.sigla})` : l.nome]);
  return mapa;
}
