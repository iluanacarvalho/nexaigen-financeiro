// Território comercial (rodada 16-A2) — REGRAS PURAS, sem banco ("hoje"
// sempre parâmetro). UMA função de status e UMA de plano, usadas por TODAS
// as telas (Território, tela da entidade, etiquetas, exportação, lote).
// Leitura: lib/territorioRepositorio.ts; escrita (lote): lib/territorioServico.ts.
//
// STATUS COMERCIAL do município, nesta precedência:
//   1) cliente — há cliente_prefeitura do município (mesmo código IBGE; ou,
//      se o cliente não tem código, mesmo nome normalizado + UF — e a linha
//      ganha o aviso "cliente sem código IBGE, corrigir") com contrato
//      VIGENTE hoje (ativo, em aviso prévio, suspenso). Se TODOS os clientes
//      do município estão encerrados hoje → "ex-cliente" (regra da 16-A1,
//      lib/crm.ts#clienteEncerrado), não "cliente";
//   2) em negociação — lead ABERTO (etapa e vendedor);
//   3) perdido — o lead mais recente foi perdido (motivo e data);
//   4) não abordado.
//
// PLANO EFETIVO, nesta precedência:
//   a) cliente vigente → plano CONTRATADO ("contratado");
//   b) lead aberto com plano de interesse → "de interesse";
//   c) senão → plano SUGERIDO pela população (lib/planos.ts, as 4 faixas,
//      inclusive Dispensa) → "sugerido pela população";
//   d) sem população → "sem plano definido".
// Contratado diferente do sugerido → aviso discreto "plano diferente do
// sugerido pela população" (nunca bloqueia nada).
//
// PRIVACIDADE (regra da 16-A): em município com lead de COLEGA, vendas vê SÓ
// o vendedor e a etapa. `montarLinha` escreve cada chave à mão — o plano de
// interesse, o motivo da perda, as datas e os selos do lead de colega nunca
// entram na linha (o teste de integração confere as chaves EXATAS).

import { ETAPAS_ABERTAS, ROTULO_ETAPA, acaoVencida, clienteEncerrado, diaEmSaoPaulo, etapaAberta, leadParado, type Etapa, type EtapaAberta } from "./crm";
import { rotuloStatusContrato, statusContratoNaData, STATUS_CONTRATO } from "./cancelamentoContrato";
import { nomeDeMunicipioNormalizado, normalizarNome } from "./ibge";
import { IDS_PLANOS, PLANOS, ehIdPlano, planoSugeridoPorPopulacao, rotuloDoPlano, type IdPlano } from "./planos";
import { UFS_BRASIL } from "./entidades";

// --- Status ------------------------------------------------------------------------

export const STATUS_COMERCIAIS = ["cliente", "em_negociacao", "perdido", "ex_cliente", "nao_abordado"] as const;
export type StatusComercial = (typeof STATUS_COMERCIAIS)[number];
export const ROTULO_STATUS_COMERCIAL: Record<StatusComercial, string> = {
  cliente: "Cliente",
  em_negociacao: "Em negociação",
  perdido: "Perdido",
  ex_cliente: "Ex-cliente",
  nao_abordado: "Não abordado"
};

export interface ClienteDoTerritorio {
  nome: string;
  uf: string;
  codigo_ibge: string | null;
  status_contrato: string;
  cancelamento_termino_em: string | null;
  /** Último evento 'contrato_encerrado' (0011), se houver. */
  encerrado_em: string | null;
  plano: string;
  data_inicio_contrato: string;
}

export interface LeadDoTerritorio {
  id: string;
  municipio_nome: string;
  nome_busca: string;
  uf: string;
  codigo_ibge: string | null;
  etapa: Etapa;
  vendedor_id: string;
  vendedor_nome: string;
  plano_interesse: string | null;
  motivo_perda: string | null;
  proxima_acao_em: string | null;
  atualizado_em: string;
  ultima_atividade_em: string;
}

export interface MunicipioDoTerritorio {
  codigo_ibge: string;
  nome: string;
  uf: string;
  populacao: number | null;
  populacao_ano: number | null;
  microrregiao: string | null;
  mesorregiao: string | null;
}

/** Clientes do município: mesmo código; cliente SEM código casa por UF + nome normalizado. */
export function clientesDoMunicipioBase<T extends Pick<ClienteDoTerritorio, "nome" | "uf" | "codigo_ibge">>(clientes: readonly T[], m: Pick<MunicipioDoTerritorio, "codigo_ibge" | "nome" | "uf">): T[] {
  const nome = nomeDeMunicipioNormalizado(m.nome);
  return clientes.filter((c) => c.codigo_ibge === m.codigo_ibge || (c.codigo_ibge === null && c.uf === m.uf && nomeDeMunicipioNormalizado(c.nome) === nome));
}

/** Leads do município: mesmo código; lead SEM código casa por UF + nome normalizado. Nunca 'ganho' (fechamento é a 16-B). */
export function leadsDoMunicipioBase<T extends Pick<LeadDoTerritorio, "nome_busca" | "uf" | "codigo_ibge" | "etapa">>(leads: readonly T[], m: Pick<MunicipioDoTerritorio, "codigo_ibge" | "nome" | "uf">): T[] {
  const nome = nomeDeMunicipioNormalizado(m.nome);
  return leads.filter((l) => l.etapa !== "ganho" && (l.codigo_ibge === m.codigo_ibge || (l.codigo_ibge === null && l.uf === m.uf && l.nome_busca === nome)));
}

export interface SituacaoComercial {
  status: StatusComercial;
  /** Cliente vigente escolhido (o de contrato "mais vivo": ativo > em aviso prévio > suspenso). */
  clienteVigente: ClienteDoTerritorio | null;
  /** Situação do contrato HOJE (lib/cancelamentoContrato.ts#statusContratoNaData). */
  situacaoContrato: string | null;
  exClienteEncerradoEm: string | null;
  /** Algum cliente do município casou só pelo nome (sem código IBGE) — "corrigir". */
  clienteSemCodigo: boolean;
  leadAberto: LeadDoTerritorio | null;
  /** O lead perdido mais recente (só quando não há lead aberto). */
  leadPerdido: LeadDoTerritorio | null;
}

/** STATUS COMERCIAL (precedência no topo do arquivo). `clientes` e `leads` já são os DO município. */
export function situacaoComercial(clientes: readonly ClienteDoTerritorio[], leads: readonly LeadDoTerritorio[], hoje: string): SituacaoComercial {
  const vigentes = clientes
    .filter((c) => !clienteEncerrado(c, hoje))
    .sort((a, b) => (STATUS_CONTRATO as readonly string[]).indexOf(statusContratoNaData(a, hoje)) - (STATUS_CONTRATO as readonly string[]).indexOf(statusContratoNaData(b, hoje)));
  const leadAberto = leads.find((l) => etapaAberta(l.etapa)) ?? null;
  const leadPerdido = leadAberto ? null : ([...leads].filter((l) => l.etapa === "perdido").sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em))[0] ?? null);
  const datas = clientes.map((c) => c.encerrado_em ?? c.cancelamento_termino_em).filter((d): d is string => d !== null).sort();
  const base = { clienteSemCodigo: clientes.some((c) => c.codigo_ibge === null), leadAberto, leadPerdido };
  if (vigentes.length > 0) return { ...base, status: "cliente", clienteVigente: vigentes[0], situacaoContrato: statusContratoNaData(vigentes[0], hoje), exClienteEncerradoEm: null };
  if (clientes.length > 0) return { ...base, status: "ex_cliente", clienteVigente: null, situacaoContrato: null, exClienteEncerradoEm: datas.at(-1) ?? null };
  return { ...base, status: leadAberto ? "em_negociacao" : leadPerdido ? "perdido" : "nao_abordado", clienteVigente: null, situacaoContrato: null, exClienteEncerradoEm: null };
}

// --- Plano efetivo --------------------------------------------------------------------

export const ORIGENS_PLANO = ["contratado", "interesse", "sugerido", "sem_plano"] as const;
export type OrigemPlano = (typeof ORIGENS_PLANO)[number];
export const ROTULO_ORIGEM_PLANO: Record<OrigemPlano, string> = {
  contratado: "contratado",
  interesse: "de interesse",
  sugerido: "sugerido pela população",
  sem_plano: "sem plano definido"
};
export const AVISO_PLANO_DIFERENTE = "plano diferente do sugerido pela população";

export interface PlanoEfetivo {
  id: IdPlano | null;
  origem: OrigemPlano;
  /** O que a população sugere (pode ser null sem população). */
  sugerido: IdPlano | null;
  /** Contratado ≠ sugerido (aviso discreto; nunca bloqueia). */
  divergente: boolean;
}

/** PLANO EFETIVO (precedência no topo do arquivo). `planoInteresse` = do lead aberto VISÍVEL pra quem lê. */
export function planoEfetivo(e: { planoContratado: string | null; planoInteresse: string | null; populacao: number | null }): PlanoEfetivo {
  const sugerido = planoSugeridoPorPopulacao(e.populacao);
  if (e.planoContratado && ehIdPlano(e.planoContratado)) return { id: e.planoContratado, origem: "contratado", sugerido, divergente: sugerido !== null && sugerido !== e.planoContratado };
  if (e.planoInteresse && ehIdPlano(e.planoInteresse)) return { id: e.planoInteresse, origem: "interesse", sugerido, divergente: false };
  if (sugerido) return { id: sugerido, origem: "sugerido", sugerido, divergente: false };
  return { id: null, origem: "sem_plano", sugerido: null, divergente: false };
}

/** Texto do plano pra tela/planilha: "Pequeno Porte" ou "Sem plano definido". */
export function rotuloPlanoEfetivo(p: Pick<PlanoEfetivo, "id">): string {
  return p.id ? rotuloDoPlano(p.id) : "Sem plano definido";
}

// --- Linha do Território ----------------------------------------------------------------

/** Lead de COLEGA visto por vendas: SÓ estas duas chaves. */
export interface LeadMinimoNoTerritorio {
  etapa: Etapa;
  vendedor_nome: string;
}
/** Lead visível por inteiro (admin, ou o próprio vendedor). */
export interface LeadVisivelNoTerritorio {
  id: string;
  etapa: Etapa;
  vendedor_id: string;
  vendedor_nome: string;
  meu: boolean;
  parado: boolean;
  acao_vencida: boolean;
  motivo_perda: string | null;
  /** Dia (SP) da última atualização do lead perdido; null pra lead aberto. */
  perdido_em: string | null;
}
export type LeadNoTerritorio = LeadMinimoNoTerritorio | LeadVisivelNoTerritorio;

export function leadVisivel(l: LeadNoTerritorio | null): l is LeadVisivelNoTerritorio {
  return l !== null && "id" in l;
}

export interface EntidadeEtiqueta {
  id: string;
  nome: string;
  sigla: string | null;
  /** Prefeituras desta entidade que JÁ são clientes (argumento de venda). */
  clientes: number;
}

export interface LinhaTerritorio {
  codigo_ibge: string;
  nome: string;
  uf: string;
  populacao: number | null;
  populacao_ano: number | null;
  microrregiao: string | null;
  mesorregiao: string | null;
  status: StatusComercial;
  /** Cliente vigente: situação do contrato hoje, plano contratado, início. null fora de "cliente". */
  contrato: { situacao: string; plano: string; desde: string } | null;
  ex_cliente_encerrado_em: string | null;
  cliente_sem_codigo: boolean;
  /** Lead aberto (ou o perdido mais recente). Pra vendas, lead de colega = só etapa e vendedor. */
  lead: LeadNoTerritorio | null;
  plano: PlanoEfetivo;
  entidades: EntidadeEtiqueta[];
}

export interface Leitor {
  equipeId: string;
  admin: boolean;
}

/** Monta a linha CHAVE A CHAVE (nada do que veio do banco "a mais" escapa). */
export function montarLinha(
  m: MunicipioDoTerritorio,
  clientesDoMunicipio: readonly ClienteDoTerritorio[],
  leadsDoMunicipio: readonly LeadDoTerritorio[],
  entidades: readonly EntidadeEtiqueta[],
  leitor: Leitor,
  hoje: string
): LinhaTerritorio {
  const s = situacaoComercial(clientesDoMunicipio, leadsDoMunicipio, hoje);
  const leadBruto = s.leadAberto ?? s.leadPerdido;
  const ve = leadBruto !== null && (leitor.admin || leadBruto.vendedor_id === leitor.equipeId);
  let lead: LeadNoTerritorio | null = null;
  if (leadBruto && ve) {
    lead = {
      id: leadBruto.id,
      etapa: leadBruto.etapa,
      vendedor_id: leadBruto.vendedor_id,
      vendedor_nome: leadBruto.vendedor_nome,
      meu: leadBruto.vendedor_id === leitor.equipeId,
      parado: leadParado(leadBruto.etapa, leadBruto.ultima_atividade_em, hoje),
      acao_vencida: acaoVencida(leadBruto.etapa, leadBruto.proxima_acao_em, hoje),
      motivo_perda: leadBruto.etapa === "perdido" ? leadBruto.motivo_perda : null,
      perdido_em: leadBruto.etapa === "perdido" ? diaEmSaoPaulo(leadBruto.atualizado_em) : null
    };
  } else if (leadBruto) {
    lead = { etapa: leadBruto.etapa, vendedor_nome: leadBruto.vendedor_nome };
  }
  return {
    codigo_ibge: m.codigo_ibge,
    nome: m.nome,
    uf: m.uf,
    populacao: m.populacao,
    populacao_ano: m.populacao_ano,
    microrregiao: m.microrregiao,
    mesorregiao: m.mesorregiao,
    status: s.status,
    contrato: s.clienteVigente ? { situacao: s.situacaoContrato!, plano: s.clienteVigente.plano, desde: s.clienteVigente.data_inicio_contrato } : null,
    ex_cliente_encerrado_em: s.exClienteEncerradoEm,
    cliente_sem_codigo: s.clienteSemCodigo,
    lead,
    // Plano de interesse SÓ de lead aberto visível (o de colega não vaza nem pela origem do plano).
    plano: planoEfetivo({ planoContratado: s.clienteVigente?.plano ?? null, planoInteresse: s.leadAberto && ve ? s.leadAberto.plano_interesse : null, populacao: m.populacao }),
    entidades: entidades.map((e) => ({ id: e.id, nome: e.nome, sigla: e.sigla, clientes: e.clientes }))
  };
}

/** Texto do status pra tela/planilha: "Cliente — Ativo", "Em negociação — Proposta", "Ex-cliente", … */
export function rotuloStatusDaLinha(l: Pick<LinhaTerritorio, "status" | "contrato" | "lead">): string {
  if (l.status === "cliente" && l.contrato) return `Cliente — ${rotuloStatusContrato(l.contrato.situacao)}`;
  if (l.status === "em_negociacao" && l.lead) return `Em negociação — ${ROTULO_ETAPA[l.lead.etapa]}`;
  return ROTULO_STATUS_COMERCIAL[l.status];
}

// --- Resumo -------------------------------------------------------------------------------

/** % de cobertura = clientes ÷ total, 1 casa decimal. Total zero → null ("—"), nunca divisão por zero. */
export function percentualCobertura(clientes: number, total: number): number | null {
  return total === 0 ? null : Math.round((clientes / total) * 1000) / 10;
}

export interface ResumoTerritorio {
  total: number;
  clientes: number;
  em_negociacao: number;
  perdidos: number;
  ex_clientes: number;
  nao_abordados: number;
  cobertura: number | null;
}

export function resumirLinhas(linhas: readonly Pick<LinhaTerritorio, "status">[]): ResumoTerritorio {
  const n = (s: StatusComercial) => linhas.filter((l) => l.status === s).length;
  const clientes = n("cliente");
  return { total: linhas.length, clientes, em_negociacao: n("em_negociacao"), perdidos: n("perdido"), ex_clientes: n("ex_cliente"), nao_abordados: n("nao_abordado"), cobertura: percentualCobertura(clientes, linhas.length) };
}

/** "37 prefeituras" / "1 prefeitura" / "Nenhuma prefeitura". */
export function textoContagem(n: number): string {
  return n === 0 ? "Nenhuma prefeitura" : `${n.toLocaleString("pt-BR")} ${n === 1 ? "prefeitura" : "prefeituras"}`;
}

/** Cabeçalho da tela da entidade. */
export function textoClientesDaEntidade(clientes: number, total: number): string {
  if (clientes === 0) return "Nenhuma prefeitura desta entidade fechou ainda";
  return `${clientes} de ${total} ${total === 1 ? "prefeitura já é cliente" : "prefeituras já são clientes"} da NEXAIGEN`;
}

/** Etiqueta da entidade: "3 prefeituras desta entidade já são clientes". */
export function textoClientesNaEtiqueta(clientes: number): string {
  if (clientes === 0) return "nenhuma prefeitura desta entidade é cliente ainda";
  return clientes === 1 ? "1 prefeitura desta entidade já é cliente" : `${clientes} prefeituras desta entidade já são clientes`;
}

// --- Filtros (URL) ---------------------------------------------------------------------------

export const PLANOS_FILTRO = [...IDS_PLANOS, "sem_plano"] as const;
export type PlanoFiltro = (typeof PLANOS_FILTRO)[number];
export const ROTULO_PLANO_FILTRO: Record<PlanoFiltro, string> = { ...Object.fromEntries(PLANOS.map((p) => [p.id, p.rotulo])), sem_plano: "Sem plano definido" } as Record<PlanoFiltro, string>;

export const ORDENACOES_TERRITORIO = ["nome", "populacao", "status", "plano"] as const;
export type OrdenacaoTerritorio = (typeof ORDENACOES_TERRITORIO)[number];
export const POR_PAGINA_TERRITORIO = 100;

export interface FiltrosTerritorio {
  uf?: string;
  planos: PlanoFiltro[];
  /** Mostra só plano contratado ou de interesse (ignora o sugerido pela população). */
  ignorarSugerido: boolean;
  entidade?: string;
  status?: StatusComercial;
  etapa?: EtapaAberta;
  /** Só admin. */
  vendedor?: string;
  microrregiao?: string;
  populacaoMin?: number;
  populacaoMax?: number;
  parado: boolean;
  acaoVencida: boolean;
  busca?: string;
  ordenar: OrdenacaoTerritorio;
  direcao: "asc" | "desc";
  pagina: number;
}

export const FILTROS_VAZIOS: FiltrosTerritorio = { planos: [], ignorarSugerido: false, parado: false, acaoVencida: false, ordenar: "nome", direcao: "asc", pagina: 1 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parâmetros que esta tela entende na URL (a visão salva só guarda estes). */
export const PARAMETROS_TERRITORIO = ["uf", "plano", "ignorar_sugerido", "entidade", "status", "etapa", "vendedor", "micro", "pop_min", "pop_max", "parado", "vencida", "busca", "ordenar", "direcao", "pagina"] as const;

/** Telas que têm visão salva (crm_visao_salva.tela). */
export const TELAS_VISAO = ["territorio", "leads", "entidade"] as const;
export type TelaVisao = (typeof TELAS_VISAO)[number];

/** Parâmetros que cada tela guarda numa visão salva (os mesmos da URL da tela; a página nunca). */
export const PARAMETROS_POR_TELA: Record<TelaVisao, readonly string[]> = {
  territorio: PARAMETROS_TERRITORIO.filter((p) => p !== "pagina"),
  entidade: PARAMETROS_TERRITORIO.filter((p) => p !== "pagina" && p !== "uf"),
  leads: ["etapa", "vendedor_id", "uf", "origem", "busca", "parados", "vencidas", "plano", "ignorar_sugerido", "entidade", "ordenar", "direcao"]
};

type Entrada = URLSearchParams | Record<string, string | string[] | undefined>;
function ler(entrada: Entrada, chave: string): string | undefined {
  if (entrada instanceof URLSearchParams) return entrada.get(chave) ?? undefined;
  const v = entrada[chave];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Lê os filtros da URL (link compartilhável / visão salva). NUNCA quebra a
 * tela: valor inválido é IGNORADO e vira um aviso. A checagem contra o banco
 * (entidade existe? estado liberado? vendedor só pra admin?) é
 * `sanearFiltros`, depois.
 */
export function lerFiltrosTerritorio(entrada: Entrada): { filtros: FiltrosTerritorio; avisos: string[] } {
  const avisos: string[] = [];
  const f: FiltrosTerritorio = { ...FILTROS_VAZIOS, planos: [] };
  const texto = (chave: string, max = 120) => {
    const v = ler(entrada, chave)?.trim();
    return v ? v.slice(0, max) : undefined;
  };
  const inteiro = (chave: string, rotulo: string) => {
    const v = texto(chave, 12);
    if (v === undefined) return undefined;
    if (!/^[0-9]+$/.test(v)) {
      avisos.push(`${rotulo} "${v}" ignorada (use só números).`);
      return undefined;
    }
    return Number(v);
  };

  const uf = texto("uf", 2)?.toUpperCase();
  if (uf && UFS_BRASIL.includes(uf)) f.uf = uf;
  else if (uf) avisos.push(`UF "${uf}" ignorada.`);

  for (const p of (texto("plano", 200) ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    if ((PLANOS_FILTRO as readonly string[]).includes(p)) {
      if (!f.planos.includes(p as PlanoFiltro)) f.planos.push(p as PlanoFiltro);
    } else avisos.push(`Plano "${p}" ignorado.`);
  }
  f.planos.sort((a, b) => PLANOS_FILTRO.indexOf(a) - PLANOS_FILTRO.indexOf(b));
  f.ignorarSugerido = texto("ignorar_sugerido") === "1";

  const entidade = texto("entidade", 40);
  if (entidade && UUID.test(entidade)) f.entidade = entidade.toLowerCase();
  else if (entidade) avisos.push("Entidade do filtro não encontrada — filtro ignorado.");

  const status = texto("status", 30);
  if (status && (STATUS_COMERCIAIS as readonly string[]).includes(status)) f.status = status as StatusComercial;
  else if (status) avisos.push(`Status "${status}" ignorado.`);

  const etapa = texto("etapa", 30);
  if (etapa && (ETAPAS_ABERTAS as readonly string[]).includes(etapa)) f.etapa = etapa as EtapaAberta;
  else if (etapa) avisos.push(`Etapa "${etapa}" ignorada.`);

  const vendedor = texto("vendedor", 40);
  if (vendedor && UUID.test(vendedor)) f.vendedor = vendedor.toLowerCase();
  else if (vendedor) avisos.push("Vendedor do filtro inválido — filtro ignorado.");

  f.microrregiao = texto("micro", 200);
  f.populacaoMin = inteiro("pop_min", "População mínima");
  f.populacaoMax = inteiro("pop_max", "População máxima");
  f.parado = texto("parado") === "1";
  f.acaoVencida = texto("vencida") === "1";
  f.busca = texto("busca", 60);

  const ordenar = texto("ordenar", 20);
  if (ordenar && (ORDENACOES_TERRITORIO as readonly string[]).includes(ordenar)) f.ordenar = ordenar as OrdenacaoTerritorio;
  f.direcao = texto("direcao") === "desc" ? "desc" : "asc";
  const pagina = inteiro("pagina", "Página");
  f.pagina = pagina && pagina >= 1 && pagina <= 10_000 ? pagina : 1;
  return { filtros: f, avisos };
}

/** Filtros → query string ESTÁVEL (mesma ordem sempre; padrões omitidos). `semPagina` pra links de filtro/visões. */
export function montarQueryTerritorio(f: FiltrosTerritorio, opcoes: { semPagina?: boolean } = {}): string {
  const p = new URLSearchParams();
  if (f.uf) p.set("uf", f.uf);
  if (f.planos.length) p.set("plano", f.planos.join(","));
  if (f.ignorarSugerido) p.set("ignorar_sugerido", "1");
  if (f.entidade) p.set("entidade", f.entidade);
  if (f.status) p.set("status", f.status);
  if (f.etapa) p.set("etapa", f.etapa);
  if (f.vendedor) p.set("vendedor", f.vendedor);
  if (f.microrregiao) p.set("micro", f.microrregiao);
  if (f.populacaoMin !== undefined) p.set("pop_min", String(f.populacaoMin));
  if (f.populacaoMax !== undefined) p.set("pop_max", String(f.populacaoMax));
  if (f.parado) p.set("parado", "1");
  if (f.acaoVencida) p.set("vencida", "1");
  if (f.busca) p.set("busca", f.busca);
  if (f.ordenar !== "nome") p.set("ordenar", f.ordenar);
  if (f.direcao !== "asc") p.set("direcao", f.direcao);
  if (!opcoes.semPagina && f.pagina > 1) p.set("pagina", String(f.pagina));
  return p.toString();
}

/**
 * Confere os filtros contra o que EXISTE e o que quem lê PODE ver — filtro
 * salvo que aponta pra entidade removida (inativa/inexistente) ou estado não
 * liberado não quebra a tela: é ignorado com aviso. Vendedor só pra admin.
 */
export function sanearFiltros(
  f: FiltrosTerritorio,
  contexto: { admin: boolean; ufsVisiveis: readonly string[]; entidadeExiste: (id: string) => boolean }
): { filtros: FiltrosTerritorio; avisos: string[] } {
  const avisos: string[] = [];
  const s: FiltrosTerritorio = { ...f, planos: [...f.planos] };
  if (s.uf && !contexto.ufsVisiveis.includes(s.uf)) {
    avisos.push(`O estado ${s.uf} não está liberado para o comercial — filtro de UF ignorado.`);
    delete s.uf;
  }
  if (s.entidade && !contexto.entidadeExiste(s.entidade)) {
    avisos.push("A entidade deste filtro não existe mais (ou foi desativada) — filtro ignorado.");
    delete s.entidade;
  }
  if (s.vendedor && !contexto.admin) {
    avisos.push("Só administrador filtra por vendedor — filtro ignorado.");
    delete s.vendedor;
  }
  if (s.populacaoMin !== undefined && s.populacaoMax !== undefined && s.populacaoMin > s.populacaoMax) {
    avisos.push("População mínima maior que a máxima — faixa de população ignorada.");
    delete s.populacaoMin;
    delete s.populacaoMax;
  }
  return { filtros: s, avisos };
}

/** O plano da linha casa com o filtro de plano? (`ignorarSugerido`: só contratado/de interesse contam.) */
export function casaPlano(p: Pick<PlanoEfetivo, "id" | "origem">, planos: readonly PlanoFiltro[], ignorarSugerido: boolean): boolean {
  const considerado = ignorarSugerido && p.origem === "sugerido" ? null : p.id;
  if (planos.length === 0) return !ignorarSugerido || considerado !== null;
  return considerado === null ? planos.includes("sem_plano") : planos.includes(considerado);
}

/** Aplica TODOS os filtros (AND). UF e entidade já delimitam o que foi carregado, mas são conferidos aqui também. */
export function filtrarLinhas(linhas: readonly LinhaTerritorio[], f: FiltrosTerritorio): LinhaTerritorio[] {
  const busca = f.busca ? normalizarNome(f.busca) : "";
  return linhas.filter((l) => {
    if (f.uf && l.uf !== f.uf) return false;
    if (f.entidade && !l.entidades.some((e) => e.id === f.entidade)) return false;
    if (!casaPlano(l.plano, f.planos, f.ignorarSugerido)) return false;
    if (f.status && l.status !== f.status) return false;
    if (f.etapa && l.lead?.etapa !== f.etapa) return false;
    if (f.vendedor && !(leadVisivel(l.lead) && l.lead.vendedor_id === f.vendedor)) return false;
    if (f.microrregiao && l.microrregiao !== f.microrregiao) return false;
    if (f.populacaoMin !== undefined && (l.populacao === null || l.populacao < f.populacaoMin)) return false;
    if (f.populacaoMax !== undefined && (l.populacao === null || l.populacao > f.populacaoMax)) return false;
    // "Parado" e "ação vencida" só existem pra lead VISÍVEL (de colega, vendas não sabe — não entra).
    if (f.parado && !(leadVisivel(l.lead) && l.lead.parado)) return false;
    if (f.acaoVencida && !(leadVisivel(l.lead) && l.lead.acao_vencida)) return false;
    if (busca && !normalizarNome(l.nome).includes(busca) && !l.codigo_ibge.startsWith(busca)) return false;
    return true;
  });
}

const ordemPlano = (p: PlanoEfetivo) => (p.id ? IDS_PLANOS.indexOf(p.id) : IDS_PLANOS.length);

/** Ordena (sem mutar). População/plano sem valor ficam SEMPRE no fim; empate → nome. */
export function ordenarLinhas(linhas: readonly LinhaTerritorio[], ordenar: OrdenacaoTerritorio, direcao: "asc" | "desc"): LinhaTerritorio[] {
  const sinal = direcao === "asc" ? 1 : -1;
  const porNome = (a: LinhaTerritorio, b: LinhaTerritorio) => normalizarNome(a.nome).localeCompare(normalizarNome(b.nome)) || a.codigo_ibge.localeCompare(b.codigo_ibge);
  return [...linhas].sort((a, b) => {
    if (ordenar === "nome") return sinal * porNome(a, b);
    if (ordenar === "populacao") {
      if (a.populacao === null || b.populacao === null) return a.populacao === b.populacao ? porNome(a, b) : a.populacao === null ? 1 : -1;
      return sinal * (a.populacao - b.populacao) || porNome(a, b);
    }
    if (ordenar === "status") return sinal * (STATUS_COMERCIAIS.indexOf(a.status) - STATUS_COMERCIAIS.indexOf(b.status)) || porNome(a, b);
    if (a.plano.id === null || b.plano.id === null) return a.plano.id === b.plano.id ? porNome(a, b) : a.plano.id === null ? 1 : -1;
    return sinal * (ordemPlano(a.plano) - ordemPlano(b.plano)) || porNome(a, b);
  });
}

/** Descrição dos filtros pra cabeçalho de planilha: "UF PR · plano Pequeno Porte, Sem plano definido · …". */
export function descreverFiltros(f: FiltrosTerritorio, nomes: { entidade?: string; vendedor?: string } = {}): string {
  const partes: string[] = [];
  if (f.uf) partes.push(`UF ${f.uf}`);
  if (f.planos.length) partes.push(`plano ${f.planos.map((p) => ROTULO_PLANO_FILTRO[p]).join(", ")}`);
  if (f.ignorarSugerido) partes.push("ignorando o plano sugerido pela população");
  if (f.entidade) partes.push(`entidade ${nomes.entidade ?? f.entidade}`);
  if (f.status) partes.push(`status ${ROTULO_STATUS_COMERCIAL[f.status]}`);
  if (f.etapa) partes.push(`etapa ${ROTULO_ETAPA[f.etapa]}`);
  if (f.vendedor) partes.push(`vendedor ${nomes.vendedor ?? f.vendedor}`);
  if (f.microrregiao) partes.push(`microrregião ${f.microrregiao}`);
  if (f.populacaoMin !== undefined) partes.push(`população ≥ ${f.populacaoMin.toLocaleString("pt-BR")}`);
  if (f.populacaoMax !== undefined) partes.push(`população ≤ ${f.populacaoMax.toLocaleString("pt-BR")}`);
  if (f.parado) partes.push("só parados");
  if (f.acaoVencida) partes.push("só ação vencida");
  if (f.busca) partes.push(`busca "${f.busca}"`);
  return partes.join(" · ");
}

// --- Lote ("Criar leads para…") -------------------------------------------------------------

/**
 * `selecao`: as linhas marcadas — cria pra quem NÃO tem lead aberto nem
 * cliente vigente (não abordado, perdido, ex-cliente). `nao_abordados`
 * ("todas as ainda não abordadas" da entidade / dos resultados): SÓ status
 * "não abordado". Devolve o motivo de PULAR, ou null (cria).
 */
export type ModoLote = "selecao" | "nao_abordados";

export function motivoParaPular(l: Pick<LinhaTerritorio, "status" | "contrato" | "lead">, modo: ModoLote): string | null {
  if (l.status === "cliente") return `já é cliente (contrato ${rotuloStatusContrato(l.contrato?.situacao ?? "").toLowerCase()})`;
  if (l.lead && etapaAberta(l.lead.etapa)) return `já tem lead aberto com ${l.lead.vendedor_nome} — etapa ${ROTULO_ETAPA[l.lead.etapa]}`;
  if (modo === "nao_abordados" && l.status === "perdido") return "já foi abordada (lead perdido — reabra o lead, se for o caso)";
  if (modo === "nao_abordados" && l.status === "ex_cliente") return "ex-cliente (não entra em \"não abordadas\" — selecione a linha, se for o caso)";
  return null;
}

export const LIMITE_LOTE = 1000;
