// Escrita do CRM (rodada 16-A). Cada ação numa transação com o lead
// TRAVADO (`select ... for update`) e o filtro de escopo NO SQL
// (lib/crmRepositorio.ts#condicaoEscopo): vendas só escreve nos leads em
// que é o vendedor — lead de colega "não existe" (nao_encontrado → 404).
// A ÚNICA escrita permitida sobre lead de colega é o pedido de
// reatribuição (pedirLead), que não muda nada no lead.
//
// Mudança de etapa, edição e troca de vendedor gravam o lead e a linha de
// histórico (lead_interacao, somente acréscimo) NA MESMA transação — ou
// entram as duas, ou nenhuma. Toda alteração do lead soma 1 em `versao`
// (controle otimista: o PATCH manda a versão que leu).
//
// 'ganho' nunca é gravado aqui (lib/crm.ts#validarTransicao): o fechamento
// é a rodada 16-B.
//
// `executor` opcional em todas: roda dentro de uma transação que já existe
// (testes); sem ele, cada função abre a sua.

import { query, withTransaction, type Executor } from "./db";
import {
  ROTULO_ETAPA,
  ROTULO_MOTIVO_PERDA,
  clienteEncerrado,
  clientesDoMunicipio,
  TIPOS_ATIVIDADE,
  etapaAberta,
  podePedirLead,
  validarTransicao,
  valorSugeridoCentavos,
  type AcaoEtapa,
  type Etapa,
  type TipoContato,
  type TipoInteracao
} from "./crm";
import { condicaoEscopo, lerClientesDosMunicipios, type EscopoCrm } from "./crmRepositorio";
import { nomeDeMunicipioNormalizado } from "./ibge";
import { rotuloStatusContrato, statusContratoNaData } from "./cancelamentoContrato";
import { hojeEmSaoPaulo } from "./painelFinanceiro";
import type { IdPlano } from "./planos";

export type FalhaCrm =
  | { ok: false; motivo: "nao_encontrado" }
  | { ok: false; motivo: "conflito" | "dados_invalidos" | "proibido" | "ja_cliente"; erro: string; campo?: string }
  | { ok: false; motivo: "duplicado"; erro: string; duplicado: { vendedor_nome: string; etapa: Etapa; id?: string } };

export type ResultadoCrm<T = object> = ({ ok: true } & T) | FalhaCrm;

class Recusa extends Error {
  constructor(readonly falha: FalhaCrm) {
    super("ação do CRM recusada");
  }
}

const NAO_ENCONTRADO: FalhaCrm = { ok: false, motivo: "nao_encontrado" };
export const MENSAGEM_VERSAO = "Alguém alterou este lead, recarregue a página para ver a versão atual.";

async function executar<T>(fn: (c: Executor) => Promise<ResultadoCrm<T>>, executor?: Executor): Promise<ResultadoCrm<T>> {
  try {
    return await (executor ? fn(executor) : withTransaction(fn));
  } catch (erro) {
    if (erro instanceof Recusa) return erro.falha;
    throw erro;
  }
}

/** Dados cadastrais (centavos já convertidos; null = em branco). */
export interface DadosLead {
  municipio_nome: string;
  uf: string;
  codigo_ibge: string | null;
  populacao: number | null;
  plano_interesse: IdPlano | null;
  valor_mensal_estimado_centavos: number | null;
  contato_nome: string | null;
  contato_cargo: string | null;
  contato_email: string | null;
  contato_telefone: string | null;
  origem: string;
  proxima_acao_em: string | null;
  proxima_acao_descricao: string | null;
}

const CAMPOS_CADASTRAIS = [
  "municipio_nome", "uf", "codigo_ibge", "populacao", "plano_interesse", "valor_mensal_estimado_centavos",
  "contato_nome", "contato_cargo", "contato_email", "contato_telefone", "origem", "proxima_acao_em", "proxima_acao_descricao"
] as const satisfies readonly (keyof DadosLead)[];

const ROTULO_CAMPO: Record<(typeof CAMPOS_CADASTRAIS)[number], string> = {
  municipio_nome: "município", uf: "UF", codigo_ibge: "código IBGE", populacao: "população", plano_interesse: "plano de interesse",
  valor_mensal_estimado_centavos: "valor estimado", contato_nome: "nome do contato", contato_cargo: "cargo do contato",
  contato_email: "e-mail do contato", contato_telefone: "telefone do contato", origem: "origem", proxima_acao_em: "data da próxima ação",
  proxima_acao_descricao: "descrição da próxima ação"
};

async function registrarHistorico(
  c: Executor,
  e: { leadId: string; tipo: TipoInteracao; autorId: string; texto?: string | null; etapaAnterior?: Etapa | null; etapaNova?: Etapa | null }
): Promise<string> {
  const [linha] = await query<{ id: string }>(
    `insert into lead_interacao (lead_id, tipo, texto, etapa_anterior, etapa_nova, autor_id) values ($1, $2, $3, $4, $5, $6) returning id`,
    [e.leadId, e.tipo, e.texto ?? null, e.etapaAnterior ?? null, e.etapaNova ?? null, e.autorId],
    c
  );
  return linha.id;
}

/** Linha 'criacao' no histórico (lead aberto pelo Território — rodada 16-A2). Só dentro de uma transação que já existe. */
export async function registrarCriacao(c: Executor, leadId: string, autorId: string, texto: string): Promise<void> {
  await registrarHistorico(c, { leadId, tipo: "criacao", autorId, texto });
}

/** O vendedor de um lead precisa estar ATIVO e ter papel vendas ou admin (os únicos que veem o CRM). */
export const MENSAGEM_VENDEDOR_INVALIDO = "O vendedor precisa ser uma pessoa ativa da equipe com papel Vendas ou Administrador.";

/** Vendedor válido (ativo, papel vendas ou admin)? Devolve o nome, ou null. A regra é uma só (também a do lote do Território). */
export async function vendedorValido(c: Executor | undefined, vendedorId: string): Promise<{ nome: string } | null> {
  const [v] = await query<{ nome: string; papel: string; ativo: boolean }>(`select nome, papel, ativo from equipe_nexaigen where id = $1`, [vendedorId], c);
  return v && v.ativo && (v.papel === "vendas" || v.papel === "admin") ? { nome: v.nome } : null;
}

async function validarVendedor(c: Executor, vendedorId: string): Promise<{ nome: string }> {
  const v = await vendedorValido(c, vendedorId);
  if (!v) throw new Recusa({ ok: false, motivo: "dados_invalidos", campo: "vendedor_id", erro: MENSAGEM_VENDEDOR_INVALIDO });
  return v;
}

/** Mensagem de duplicidade — revela SÓ o vendedor e a etapa (o id só pro dono do lead ou admin). */
export function mensagemDuplicado(vendedorNome: string, etapa: Etapa): string {
  return `Já existe esse lead: está com ${vendedorNome}, etapa ${ROTULO_ETAPA[etapa]}.`;
}

/**
 * Duplicidade ao criar/editar/reabrir: outro lead ABERTO com o mesmo
 * código IBGE ou com o mesmo nome+UF (sem acento/caixa/"Prefeitura de"), ou
 * um CLIENTE VIGENTE do mesmo município (ex-cliente encerrado não bloqueia —
 * rodada 16-A1). O banco também garante o
 * lado dos leads (índices únicos parciais da 0014); isto dá a mensagem.
 */
async function verificarDuplicidade(
  c: Executor | undefined,
  chave: { uf: string; nomeBusca: string; codigoIbge: string | null; excluirId?: string },
  autor: EscopoCrm
): Promise<FalhaCrm | null> {
  const [lead] = await query<{ id: string; etapa: Etapa; vendedor_nome: string; vendedor_id: string }>(
    `select l.id, l.etapa, q.nome as vendedor_nome, l.vendedor_id
     from lead l join equipe_nexaigen q on q.id = l.vendedor_id
     where l.etapa not in ('ganho', 'perdido') and ($4::uuid is null or l.id <> $4::uuid)
       and ((l.uf = $1 and l.nome_busca = $2) or ($3::text is not null and l.codigo_ibge = $3::text))
     order by l.criado_em limit 1`,
    [chave.uf, chave.nomeBusca, chave.codigoIbge, chave.excluirId ?? null],
    c
  );
  if (lead) {
    const visivel = autor.admin || lead.vendedor_id === autor.equipeId;
    return { ok: false, motivo: "duplicado", erro: mensagemDuplicado(lead.vendedor_nome, lead.etapa), duplicado: { vendedor_nome: lead.vendedor_nome, etapa: lead.etapa, ...(visivel ? { id: lead.id } : {}) } };
  }
  // Cliente do mesmo município: bloqueia se ALGUM estiver vigente hoje (ativo, em aviso prévio — "encerrando" — ou
  // suspenso). Ex-cliente (contrato encerrado hoje) NÃO bloqueia: o lead é permitido e leva a marca "ex-cliente".
  const clientes = clientesDoMunicipio(await lerClientesDosMunicipios([chave.uf], chave.codigoIbge ? [chave.codigoIbge] : [], c), chave);
  const vigente = clientes.find((cl) => !clienteEncerrado(cl, hojeEmSaoPaulo(new Date())));
  if (vigente) {
    const situacao = rotuloStatusContrato(statusContratoNaData(vigente, hojeEmSaoPaulo(new Date()))).toLowerCase();
    return { ok: false, motivo: "ja_cliente", erro: `Esta prefeitura já é cliente da NEXAIGEN (contrato ${situacao}) — não é lead. Só ex-cliente com contrato encerrado pode virar lead.` };
  }
  return null;
}

/** Violação dos índices únicos de lead aberto (corrida entre a checagem e a gravação) → mesma resposta de duplicidade. */
async function traduzirUnico<T>(erro: unknown, chave: { uf: string; nomeBusca: string; codigoIbge: string | null; excluirId?: string }, autor: EscopoCrm): Promise<ResultadoCrm<T>> {
  const pg = erro as { code?: string; constraint?: string };
  if (pg?.code === "23505" && (pg.constraint === "uq_lead_codigo_ibge_aberto" || pg.constraint === "uq_lead_nome_uf_aberto")) {
    // A transação que violou o índice já foi desfeita: a mensagem sai de uma leitura nova, no pool.
    const falha = await verificarDuplicidade(undefined, chave, autor);
    return falha ?? { ok: false, motivo: "conflito", erro: "Já existe outro lead aberto para este município." };
  }
  throw erro;
}

// --- Criar ---------------------------------------------------------------------------

/**
 * Cria o lead (sempre na etapa 'novo'). Vendas: sempre atribuído a si
 * (vendedor_id diferente → proibido). Admin: pode atribuir a outro
 * vendedor. Plano escolhido sem valor informado (undefined) → sugere a
 * mensalidade padrão do plano (null explícito = "sem estimativa").
 */
export async function criarLead(
  dados: Omit<DadosLead, "valor_mensal_estimado_centavos"> & { valor_mensal_estimado_centavos?: number | null; vendedor_id?: string },
  autor: EscopoCrm,
  executor?: Executor
): Promise<ResultadoCrm<{ id: string }>> {
  const vendedorId = dados.vendedor_id ?? autor.equipeId;
  if (!autor.admin && vendedorId !== autor.equipeId) {
    return { ok: false, motivo: "proibido", erro: "Só um administrador atribui lead a outro vendedor — o lead que você cria é seu." };
  }
  const valor =
    dados.valor_mensal_estimado_centavos !== undefined ? dados.valor_mensal_estimado_centavos : dados.plano_interesse ? valorSugeridoCentavos(dados.plano_interesse) : null;
  const chave = { uf: dados.uf, nomeBusca: nomeDeMunicipioNormalizado(dados.municipio_nome), codigoIbge: dados.codigo_ibge };
  try {
    return await executar(async (c) => {
      await validarVendedor(c, vendedorId);
      const duplicado = await verificarDuplicidade(c, chave, autor);
      if (duplicado) throw new Recusa(duplicado);
      const [lead] = await query<{ id: string }>(
        `insert into lead (municipio_nome, nome_busca, uf, codigo_ibge, populacao, plano_interesse, valor_mensal_estimado_centavos,
           contato_nome, contato_cargo, contato_email, contato_telefone, origem, vendedor_id, proxima_acao_em, proxima_acao_descricao, criado_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
        [
          dados.municipio_nome.trim(), chave.nomeBusca, dados.uf, dados.codigo_ibge, dados.populacao, dados.plano_interesse, valor,
          dados.contato_nome, dados.contato_cargo, dados.contato_email, dados.contato_telefone, dados.origem, vendedorId,
          dados.proxima_acao_em, dados.proxima_acao_descricao, autor.equipeId
        ],
        c
      );
      return { ok: true as const, id: lead.id };
    }, executor);
  } catch (erro) {
    return traduzirUnico(erro, chave, autor);
  }
}

// --- Editar ----------------------------------------------------------------------------

type LinhaLead = DadosLead & { id: string; etapa: Etapa; vendedor_id: string; versao: number };

async function travarLead(c: Executor, id: string, escopo: EscopoCrm): Promise<LinhaLead> {
  const params: unknown[] = [id];
  const [lead] = await query<LinhaLead>(
    `select l.id, l.etapa, l.vendedor_id, l.versao, ${CAMPOS_CADASTRAIS.map((col) => `l.${col}`).join(", ")}
     from lead l where l.id = $1::uuid and ${condicaoEscopo(escopo, params, "l")} for update`,
    params,
    c
  );
  if (!lead) throw new Recusa(NAO_ENCONTRADO);
  return lead;
}

/**
 * Edita dados cadastrais (nunca etapa, vendedor ou motivo — cada um tem a
 * sua ação). Exige a `versao` que a tela leu: diferente → conflito
 * ("alguém alterou este lead"). Grava 'edicao' no histórico com os campos
 * alterados. Nada mudou → ok sem gravar nada.
 */
export async function editarLead(
  id: string,
  campos: Partial<DadosLead>,
  versaoLida: number,
  autor: EscopoCrm,
  executor?: Executor
): Promise<ResultadoCrm<{ versao: number; alterados: string[] }>> {
  let chave: { uf: string; nomeBusca: string; codigoIbge: string | null; excluirId?: string } = { uf: "", nomeBusca: "", codigoIbge: null, excluirId: id };
  try {
    return await executar(async (c) => {
      const atual = await travarLead(c, id, autor);
      if (atual.versao !== versaoLida) throw new Recusa({ ok: false, motivo: "conflito", erro: MENSAGEM_VERSAO });

      const novo: DadosLead = { ...atual, ...campos };
      // Data da próxima ação apagada → a descrição vai junto (o CHECK da 0014 exige data pra ter descrição).
      if (campos.proxima_acao_em === null && campos.proxima_acao_descricao === undefined) novo.proxima_acao_descricao = null;
      if (novo.proxima_acao_descricao && !novo.proxima_acao_em) {
        throw new Recusa({ ok: false, motivo: "dados_invalidos", campo: "proxima_acao_descricao", erro: "Informe a data da próxima ação junto com a descrição." });
      }
      // Plano escolhido agora, sem valor e sem estimativa anterior → sugere a mensalidade do plano.
      if (campos.plano_interesse && campos.valor_mensal_estimado_centavos === undefined && atual.valor_mensal_estimado_centavos === null) {
        novo.valor_mensal_estimado_centavos = valorSugeridoCentavos(campos.plano_interesse);
      }
      const alterados = CAMPOS_CADASTRAIS.filter((col) => (novo[col] ?? null) !== (atual[col] ?? null));
      if (alterados.length === 0) return { ok: true as const, versao: atual.versao, alterados: [] };

      chave = { uf: novo.uf, nomeBusca: nomeDeMunicipioNormalizado(novo.municipio_nome), codigoIbge: novo.codigo_ibge, excluirId: id };
      if (etapaAberta(atual.etapa) && alterados.some((col) => col === "municipio_nome" || col === "uf" || col === "codigo_ibge")) {
        const duplicado = await verificarDuplicidade(c, chave, autor);
        if (duplicado) throw new Recusa(duplicado);
      }
      const sets = CAMPOS_CADASTRAIS.map((col, i) => `${col} = $${i + 1}`).join(", ");
      const [linha] = await query<{ versao: number }>(
        `update lead set ${sets}, nome_busca = $${CAMPOS_CADASTRAIS.length + 1}, versao = versao + 1, atualizado_em = now()
         where id = $${CAMPOS_CADASTRAIS.length + 2} returning versao`,
        [...CAMPOS_CADASTRAIS.map((col) => (col === "municipio_nome" ? novo.municipio_nome.trim() : novo[col])), chave.nomeBusca, id],
        c
      );
      await registrarHistorico(c, { leadId: id, tipo: "edicao", autorId: autor.equipeId, texto: `Alterou: ${alterados.map((col) => ROTULO_CAMPO[col]).join(", ")}.` });
      return { ok: true as const, versao: linha.versao, alterados };
    }, executor);
  } catch (erro) {
    return traduzirUnico(erro, chave, autor);
  }
}

// --- Interação manual ---------------------------------------------------------------------

/** Registra um contato (nota, ligação, e-mail, reunião, WhatsApp, visita) no histórico. */
export async function registrarInteracao(id: string, dados: { tipo: TipoContato; texto: string }, autor: EscopoCrm, executor?: Executor): Promise<ResultadoCrm<{ interacaoId: string }>> {
  return executar(async (c) => {
    await travarLead(c, id, autor);
    const interacaoId = await registrarHistorico(c, { leadId: id, tipo: dados.tipo, autorId: autor.equipeId, texto: dados.texto });
    return { ok: true as const, interacaoId };
  }, executor);
}

// --- Etapa ---------------------------------------------------------------------------------

/** Muda a etapa (mover / perder com motivo / reabrir) + linha no histórico, na mesma transação. */
export async function mudarEtapa(id: string, acao: AcaoEtapa, autor: EscopoCrm, executor?: Executor): Promise<ResultadoCrm<{ etapa: Etapa; versao: number }>> {
  let chave = { uf: "", nomeBusca: "", codigoIbge: null as string | null, excluirId: id };
  try {
    return await executar(async (c) => {
      const atual = await travarLead(c, id, autor);
      const t = validarTransicao(atual.etapa, acao);
      if (!t.ok) throw new Recusa({ ok: false, motivo: "conflito", erro: t.erro });
      chave = { uf: atual.uf, nomeBusca: nomeDeMunicipioNormalizado(atual.municipio_nome), codigoIbge: atual.codigo_ibge, excluirId: id };
      if (acao.acao === "reabrir") {
        // Enquanto esteve perdido, outro lead do mesmo município pode ter sido aberto.
        const duplicado = await verificarDuplicidade(c, chave, autor);
        if (duplicado) throw new Recusa(duplicado);
      }
      const motivo = acao.acao === "perder" ? acao.motivo : null;
      const detalhe = acao.acao === "perder" ? acao.detalhe : null;
      const [linha] = await query<{ versao: number }>(
        `update lead set etapa = $1, motivo_perda = $2, detalhe_perda = $3, versao = versao + 1, atualizado_em = now() where id = $4 returning versao`,
        [t.etapaNova, motivo, detalhe, id],
        c
      );
      const texto = acao.acao === "perder" ? `Motivo: ${ROTULO_MOTIVO_PERDA[acao.motivo]}.${acao.detalhe ? ` ${acao.detalhe}` : ""}` : null;
      await registrarHistorico(c, { leadId: id, tipo: t.tipoHistorico, autorId: autor.equipeId, etapaAnterior: atual.etapa, etapaNova: t.etapaNova, texto });
      return { ok: true as const, etapa: t.etapaNova, versao: linha.versao };
    }, executor);
  } catch (erro) {
    return traduzirUnico(erro, chave, autor);
  }
}

// --- Vendedor (só admin) -------------------------------------------------------------------

async function trocarVendedorEm(c: Executor, id: string, novoVendedorId: string, admin: EscopoCrm, observacao: string | null): Promise<{ versao: number }> {
  const atual = await travarLead(c, id, { ...admin, admin: true });
  if (atual.vendedor_id === novoVendedorId) throw new Recusa({ ok: false, motivo: "conflito", erro: "Este lead já está com esse vendedor." });
  const novo = await validarVendedor(c, novoVendedorId);
  const [anterior] = await query<{ nome: string }>(`select nome from equipe_nexaigen where id = $1`, [atual.vendedor_id], c);
  const [linha] = await query<{ versao: number }>(
    `update lead set vendedor_id = $1, versao = versao + 1, atualizado_em = now() where id = $2 returning versao`,
    [novoVendedorId, id],
    c
  );
  await registrarHistorico(c, {
    leadId: id,
    tipo: "troca_vendedor",
    autorId: admin.equipeId,
    texto: `De ${anterior?.nome ?? "—"} para ${novo.nome}.${observacao ? ` ${observacao}` : ""}`
  });
  return linha;
}

/** Troca o vendedor do lead (só admin — a rota exige a área crm_gestao). */
export async function trocarVendedor(id: string, novoVendedorId: string, admin: EscopoCrm, executor?: Executor): Promise<ResultadoCrm<{ versao: number }>> {
  return executar(async (c) => ({ ok: true as const, ...(await trocarVendedorEm(c, id, novoVendedorId, admin, null)) }), executor);
}

// --- Pedido de reatribuição -----------------------------------------------------------------

/**
 * "Pedir este lead": vendedor pede um lead de COLEGA, aberto e parado há
 * mais de 60 dias (lib/crm.ts#podePedirLead). Grava o pedido e NÃO muda o
 * dono. No máximo um pedido pendente por lead + solicitante (índice único
 * parcial da 0014). É a única escrita permitida sobre lead de colega — e
 * não toca no lead.
 */
export async function pedirLead(leadId: string, solicitante: EscopoCrm, hoje: string, executor?: Executor): Promise<ResultadoCrm<{ pedidoId: string }>> {
  if (solicitante.admin) return { ok: false, motivo: "conflito", erro: "Administrador troca o vendedor direto, sem pedido." };
  try {
    return await executar(async (c) => {
      const [lead] = await query<{ vendedor_id: string; etapa: Etapa; ultima_atividade_em: string }>(
        `select l.vendedor_id, l.etapa,
                greatest(l.criado_em, (select max(i.em) from lead_interacao i where i.lead_id = l.id and i.tipo = any($2::text[]))) as ultima_atividade_em
         from lead l where l.id = $1::uuid for update`,
        [leadId, TIPOS_ATIVIDADE],
        c
      );
      if (!lead) throw new Recusa(NAO_ENCONTRADO);
      if (lead.vendedor_id === solicitante.equipeId) throw new Recusa({ ok: false, motivo: "conflito", erro: "Este lead já é seu." });
      if (!podePedirLead(lead.etapa, lead.ultima_atividade_em, hoje)) {
        throw new Recusa({ ok: false, motivo: "conflito", erro: "Só dá para pedir um lead aberto e sem atividade há mais de 60 dias." });
      }
      const [pedido] = await query<{ id: string }>(`insert into lead_pedido_reatribuicao (lead_id, solicitante_id) values ($1, $2) returning id`, [leadId, solicitante.equipeId], c);
      return { ok: true as const, pedidoId: pedido.id };
    }, executor);
  } catch (erro) {
    const pg = erro as { code?: string; constraint?: string };
    if (pg?.code === "23505" && pg.constraint === "uq_lead_pedido_pendente") return { ok: false, motivo: "conflito", erro: "Você já tem um pedido pendente para este lead." };
    throw erro;
  }
}

export const MOTIVO_LEAD_JA_REATRIBUIDO = "lead já reatribuído";

/**
 * Admin decide um pedido pendente. APROVAR = troca de vendedor pro
 * solicitante (com histórico) E, na MESMA transação, todos os OUTROS pedidos
 * pendentes do mesmo lead viram 'negado' com motivo "lead já reatribuído"
 * (rodada 16-A1) — e isso também entra no histórico do lead (no texto da
 * troca de vendedor). Pedido já decidido (inclusive negado automaticamente)
 * → conflito (409).
 */
export async function decidirPedido(pedidoId: string, decisao: "aprovado" | "negado", admin: EscopoCrm, executor?: Executor): Promise<ResultadoCrm<{ decisao: "aprovado" | "negado"; negadosAutomaticamente: number }>> {
  return executar(async (c) => {
    const [pedido] = await query<{ lead_id: string; solicitante_id: string; resolvido_em: string | null }>(
      `select lead_id, solicitante_id, resolvido_em from lead_pedido_reatribuicao where id = $1::uuid for update`,
      [pedidoId],
      c
    );
    if (!pedido) throw new Recusa(NAO_ENCONTRADO);
    if (pedido.resolvido_em) throw new Recusa({ ok: false, motivo: "conflito", erro: "Este pedido já foi decidido." });
    let negadosAutomaticamente = 0;
    if (decisao === "aprovado") {
      // Trava os outros pedidos pendentes do lead ANTES de trocar o dono: um pedido novo não entra no meio.
      const outros = await query<{ id: string; solicitante_nome: string }>(
        `select p.id, s.nome as solicitante_nome from lead_pedido_reatribuicao p join equipe_nexaigen s on s.id = p.solicitante_id
         where p.lead_id = $1 and p.id <> $2 and p.resolvido_em is null order by p.em for update of p`,
        [pedido.lead_id, pedidoId],
        c
      );
      const observacao =
        outros.length === 0
          ? "Pedido de reatribuição aprovado."
          : `Pedido de reatribuição aprovado. ${outros.length === 1 ? "Outro pedido pendente negado" : `${outros.length} outros pedidos pendentes negados`} (${outros.map((o) => o.solicitante_nome).join(", ")}): ${MOTIVO_LEAD_JA_REATRIBUIDO}.`;
      await trocarVendedorEm(c, pedido.lead_id, pedido.solicitante_id, admin, observacao);
      if (outros.length > 0) {
        await query(
          `update lead_pedido_reatribuicao set resolvido_em = now(), resolvido_por = $1, decisao = 'negado', motivo_decisao = $2 where id = any($3::uuid[])`,
          [admin.equipeId, MOTIVO_LEAD_JA_REATRIBUIDO, outros.map((o) => o.id)],
          c
        );
      }
      negadosAutomaticamente = outros.length;
    }
    await query(`update lead_pedido_reatribuicao set resolvido_em = now(), resolvido_por = $1, decisao = $2 where id = $3`, [admin.equipeId, decisao, pedidoId], c);
    return { ok: true as const, decisao, negadosAutomaticamente };
  }, executor);
}

