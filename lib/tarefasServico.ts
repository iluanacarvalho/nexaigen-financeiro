// TAREFAS OPERACIONAIS (rodada 16-B1) — Contratos (assinatura) e
// Implantação. Leitura e escrita.
//
// ISOLAMENTO NO SQL (como o CRM): quem não é admin só enxerga e só age em
// tarefa do SEU papel (`condicaoPapel`) — tarefa de outro papel "não
// existe" (404, nunca 403: não deixa enumerar). Admin vê e age em todas.
//
// DADOS DO CLIENTE: cada tarefa mostra SÓ o que o papel precisa — colunas
// escritas uma a uma e objeto montado chave a chave (o teste confere as
// chaves EXATAS). Nada financeiro além do combinado do contrato pra
// Contratos (plano, mensalidade, taxa); nada financeiro pra Implantação.
//
// Ações: assumir (aberta → em andamento, com responsável), devolver à fila,
// concluir (só implantação — a de assinatura conclui SOZINHA quando a
// assinatura é registrada), alterar prazo e cancelar (só admin, cancelar com
// motivo). Toda ação trava a tarefa (`for update`) e grava tarefa_historico
// (somente acréscimo) na MESMA transação.

import { query, withTransaction, type Executor } from "./db";
import { seloTarefa, type StatusTarefa, type TipoTarefa } from "./fechamento";
import type { AbaTarefas, AcaoTarefa } from "./fechamentoSchemas";

export interface LeitorTarefas {
  equipeId: string;
  papel: string;
}

const ehAdmin = (l: LeitorTarefas) => l.papel === "admin";

/** Condição SQL do papel — ÚNICO lugar que decide "de quem é a tarefa". */
export function condicaoPapel(leitor: LeitorTarefas, params: unknown[], alias = "t"): string {
  if (ehAdmin(leitor)) return "true";
  params.push(leitor.papel);
  return `${alias}.papel_responsavel = $${params.length}`;
}

/** Dados do cliente pra tarefa de CONTRATOS: o que vai no contrato (EXATAMENTE estas chaves). */
export interface ClienteParaContratos {
  id: string;
  nome: string;
  status_contrato: string;
  plano: string;
  valor_mensal_centavos: number;
  taxa_implantacao_centavos: number | null;
  cnpj: string | null;
  endereco_logradouro: string | null;
  endereco_numero: string | null;
  endereco_complemento: string | null;
  endereco_bairro: string | null;
  endereco_cep: string | null;
  representante_nome: string | null;
  representante_cargo: string | null;
  contato_nome: string | null;
  contato_cargo: string | null;
  contato_email: string | null;
  contato_telefone: string | null;
}

/** Dados do cliente pra tarefa de IMPLANTAÇÃO: mínimos (EXATAMENTE estas chaves) — nada financeiro. */
export interface ClienteParaImplantacao {
  id: string;
  nome: string;
  plano: string;
  uf: string;
  codigo_ibge: string | null;
  contato_nome: string | null;
  contato_cargo: string | null;
  contato_email: string | null;
  contato_telefone: string | null;
}

export interface HistoricoTarefa {
  acao: string;
  autor_nome: string | null;
  em: string;
  detalhe: string | null;
}

export interface TarefaListada {
  id: string;
  tipo: TipoTarefa;
  status: StatusTarefa;
  prazo: string;
  selo: "atrasada" | "vence_hoje" | null;
  criado_em: string;
  responsavel_nome: string | null;
  minha: boolean;
  observacao: string | null;
  cliente: ClienteParaContratos | ClienteParaImplantacao;
  historico: HistoricoTarefa[];
}

interface LinhaTarefa {
  id: string;
  tipo: TipoTarefa;
  status: StatusTarefa;
  prazo: string;
  criado_em: string;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  observacao: string | null;
  c_id: string;
  c_nome: string;
  c_status_contrato: string;
  c_plano: string;
  c_uf: string;
  c_codigo_ibge: string | null;
  c_valor_mensal: string;
  c_taxa_implantacao: string | null;
  c_cnpj: string | null;
  c_endereco_logradouro: string | null;
  c_endereco_numero: string | null;
  c_endereco_complemento: string | null;
  c_endereco_bairro: string | null;
  c_endereco_cep: string | null;
  c_representante_nome: string | null;
  c_representante_cargo: string | null;
  c_contato_nome: string | null;
  c_contato_cargo: string | null;
  c_contato_email: string | null;
  c_contato_telefone: string | null;
}

const centavos = (numeric: string) => Math.round(Number(numeric) * 100); // numeric(12,2) do banco — sempre 2 casas, sem erro de arredondamento

/** Monta o cliente CHAVE A CHAVE conforme o tipo da tarefa (nada que a consulta trouxer a mais escapa). */
export function clienteDaTarefa(l: LinhaTarefa): ClienteParaContratos | ClienteParaImplantacao {
  if (l.tipo === "contrato_assinatura") {
    return {
      id: l.c_id,
      nome: l.c_nome,
      status_contrato: l.c_status_contrato,
      plano: l.c_plano,
      valor_mensal_centavos: centavos(l.c_valor_mensal),
      taxa_implantacao_centavos: l.c_taxa_implantacao === null ? null : centavos(l.c_taxa_implantacao),
      cnpj: l.c_cnpj,
      endereco_logradouro: l.c_endereco_logradouro,
      endereco_numero: l.c_endereco_numero,
      endereco_complemento: l.c_endereco_complemento,
      endereco_bairro: l.c_endereco_bairro,
      endereco_cep: l.c_endereco_cep,
      representante_nome: l.c_representante_nome,
      representante_cargo: l.c_representante_cargo,
      contato_nome: l.c_contato_nome,
      contato_cargo: l.c_contato_cargo,
      contato_email: l.c_contato_email,
      contato_telefone: l.c_contato_telefone
    };
  }
  return {
    id: l.c_id,
    nome: l.c_nome,
    plano: l.c_plano,
    uf: l.c_uf,
    codigo_ibge: l.c_codigo_ibge,
    contato_nome: l.c_contato_nome,
    contato_cargo: l.c_contato_cargo,
    contato_email: l.c_contato_email,
    contato_telefone: l.c_contato_telefone
  };
}

const COLUNAS = `t.id, t.tipo, t.status, t.prazo, t.criado_em, t.responsavel_id, r.nome as responsavel_nome, t.observacao,
  c.id as c_id, c.nome as c_nome, c.status_contrato as c_status_contrato, c.plano as c_plano, c.uf as c_uf, c.codigo_ibge as c_codigo_ibge,
  c.valor_mensal as c_valor_mensal, c.taxa_implantacao as c_taxa_implantacao, c.cnpj as c_cnpj,
  c.endereco_logradouro as c_endereco_logradouro, c.endereco_numero as c_endereco_numero, c.endereco_complemento as c_endereco_complemento,
  c.endereco_bairro as c_endereco_bairro, c.endereco_cep as c_endereco_cep, c.representante_nome as c_representante_nome,
  c.representante_cargo as c_representante_cargo, c.contato_nome as c_contato_nome, c.contato_cargo as c_contato_cargo,
  c.contato_email as c_contato_email, c.contato_telefone as c_contato_telefone`;

export const LIMITE_TAREFAS = 200;

/**
 * Tarefas da aba, no escopo do papel. minhas = em andamento comigo; fila =
 * não assumidas (do meu papel; admin: de todos); todas/atrasadas = só admin
 * (a rota recusa as outras com 403).
 */
export async function listarTarefas(aba: AbaTarefas, leitor: LeitorTarefas, hoje: string, executor?: Executor): Promise<TarefaListada[]> {
  const params: unknown[] = [];
  const condicoes = [condicaoPapel(leitor, params)];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (aba === "minhas") condicoes.push(`t.status = 'em_andamento' and t.responsavel_id = ${p(leitor.equipeId)}::uuid`);
  else if (aba === "fila") condicoes.push(`t.status = 'aberta'`);
  else if (aba === "atrasadas") condicoes.push(`t.status in ('aberta', 'em_andamento') and t.prazo < ${p(hoje)}::date`);
  else condicoes.push(`(t.status in ('aberta', 'em_andamento') or t.criado_em > now() - interval '60 days')`);
  const linhas = await query<LinhaTarefa>(
    `select ${COLUNAS} from tarefa_operacional t
     join cliente_prefeitura c on c.id = t.cliente_id
     left join equipe_nexaigen r on r.id = t.responsavel_id
     where ${condicoes.join(" and ")}
     order by case when t.status in ('aberta', 'em_andamento') then 0 else 1 end, t.prazo, t.criado_em, t.id
     limit ${LIMITE_TAREFAS}`,
    params,
    executor
  );
  const historicos = await lerHistoricos(linhas.map((l) => l.id), executor);
  return linhas.map((l) => ({
    id: l.id,
    tipo: l.tipo,
    status: l.status,
    prazo: l.prazo,
    selo: seloTarefa(l, hoje),
    criado_em: l.criado_em,
    responsavel_nome: l.responsavel_nome,
    minha: l.responsavel_id === leitor.equipeId,
    observacao: l.observacao,
    cliente: clienteDaTarefa(l),
    historico: historicos.get(l.id) ?? []
  }));
}

async function lerHistoricos(ids: string[], executor?: Executor): Promise<Map<string, HistoricoTarefa[]>> {
  const mapa = new Map<string, HistoricoTarefa[]>();
  if (ids.length === 0) return mapa;
  const linhas = await query<HistoricoTarefa & { tarefa_id: string }>(
    `select h.tarefa_id, h.acao, a.nome as autor_nome, h.em, h.detalhe from tarefa_historico h left join equipe_nexaigen a on a.id = h.autor_id
     where h.tarefa_id = any($1::uuid[]) order by h.em, h.id`,
    [ids],
    executor
  );
  for (const h of linhas) mapa.set(h.tarefa_id, [...(mapa.get(h.tarefa_id) ?? []), { acao: h.acao, autor_nome: h.autor_nome ?? "integração Educa", em: h.em, detalhe: h.detalhe }]);
  return mapa;
}

/** Contagem pra página inicial: abertas (fila + em andamento) e atrasadas do papel (admin: todas). */
export async function contarTarefas(leitor: LeitorTarefas, hoje: string, executor?: Executor): Promise<{ abertas: number; atrasadas: number; minhas: number }> {
  const params: unknown[] = [];
  const cond = condicaoPapel(leitor, params);
  params.push(hoje, leitor.equipeId);
  const [r] = await query<{ abertas: number; atrasadas: number; minhas: number }>(
    `select count(*) filter (where t.status in ('aberta', 'em_andamento'))::int as abertas,
            count(*) filter (where t.status in ('aberta', 'em_andamento') and t.prazo < $${params.length - 1}::date)::int as atrasadas,
            count(*) filter (where t.status = 'em_andamento' and t.responsavel_id = $${params.length}::uuid)::int as minhas
     from tarefa_operacional t where ${cond}`,
    params,
    executor
  );
  return r;
}

// --- Ações --------------------------------------------------------------------------------

export type ResultadoAcaoTarefa =
  | { ok: true; status: StatusTarefa }
  | { ok: false; motivo: "nao_encontrado" }
  | { ok: false; motivo: "conflito" | "proibido"; erro: string };

class Recusa extends Error {
  constructor(readonly r: ResultadoAcaoTarefa) {
    super("ação de tarefa recusada");
  }
}

const recusa = (motivo: "conflito" | "proibido", erro: string) => new Recusa({ ok: false, motivo, erro });

export async function agirNaTarefa(id: string, acao: AcaoTarefa, leitor: LeitorTarefas, executor?: Executor): Promise<ResultadoAcaoTarefa> {
  const fazer = async (c: Executor): Promise<ResultadoAcaoTarefa> => {
    const params: unknown[] = [id];
    // Trava SÓ a tarefa e busca o nome do responsável DEPOIS: num `for update` com join, quem esperou a trava relê a
    // tarefa atualizada mas o lado do join fica com o instante antigo (o nome vinha nulo — "outra pessoa"). Achado do
    // teste de concorrência (lib/tarefas.concorrencia.integration.test.ts).
    const [travada] = await query<{ id: string; tipo: TipoTarefa; status: StatusTarefa; prazo: string; responsavel_id: string | null }>(
      `select t.id, t.tipo, t.status, t.prazo, t.responsavel_id from tarefa_operacional t
       where t.id = $1::uuid and ${condicaoPapel(leitor, params)} for update`,
      params,
      c
    );
    if (!travada) return { ok: false, motivo: "nao_encontrado" };
    const [responsavel] = travada.responsavel_id ? await query<{ nome: string }>(`select nome from equipe_nexaigen where id = $1`, [travada.responsavel_id], c) : [];
    const t = { ...travada, responsavel_nome: responsavel?.nome ?? null };
    const aberta = t.status === "aberta" || t.status === "em_andamento";
    if (!aberta) throw recusa("conflito", `Esta tarefa já está ${t.status === "concluida" ? "concluída" : "cancelada"}.`);
    const historico = (acaoH: string, detalhe: string | null) =>
      query(`insert into tarefa_historico (tarefa_id, acao, autor_id, detalhe) values ($1, $2, $3, $4)`, [t.id, acaoH, leitor.equipeId, detalhe], c);

    switch (acao.acao) {
      case "assumir": {
        if (t.status === "em_andamento") throw recusa("conflito", t.responsavel_id === leitor.equipeId ? "Esta tarefa já é sua." : `Esta tarefa já foi assumida por ${t.responsavel_nome ?? "outra pessoa"}.`);
        await query(`update tarefa_operacional set status = 'em_andamento', responsavel_id = $1, assumida_em = now() where id = $2`, [leitor.equipeId, t.id], c);
        await historico("assumida", null);
        return { ok: true, status: "em_andamento" };
      }
      case "devolver": {
        if (t.status !== "em_andamento") throw recusa("conflito", "Esta tarefa já está na fila.");
        if (t.responsavel_id !== leitor.equipeId && !ehAdmin(leitor)) throw recusa("proibido", "Só quem assumiu a tarefa (ou um administrador) devolve à fila.");
        await query(`update tarefa_operacional set status = 'aberta', responsavel_id = null, assumida_em = null where id = $1`, [t.id], c);
        await historico("devolvida", null);
        return { ok: true, status: "aberta" };
      }
      case "concluir": {
        if (t.tipo === "contrato_assinatura") throw recusa("conflito", "A tarefa de assinatura conclui sozinha quando a assinatura (data + PDF) é registrada.");
        if (t.status !== "em_andamento" && !ehAdmin(leitor)) throw recusa("conflito", "Assuma a tarefa antes de concluir.");
        if (t.status === "em_andamento" && t.responsavel_id !== leitor.equipeId && !ehAdmin(leitor)) throw recusa("proibido", `Esta tarefa está com ${t.responsavel_nome ?? "outra pessoa"}.`);
        await query(
          `update tarefa_operacional set status = 'concluida', concluida_em = now(), concluida_por = $1, responsavel_id = coalesce(responsavel_id, $1), observacao = $2 where id = $3`,
          [leitor.equipeId, acao.observacao ?? null, t.id],
          c
        );
        await historico("concluida", acao.observacao ?? null);
        return { ok: true, status: "concluida" };
      }
      case "prazo": {
        if (!ehAdmin(leitor)) throw recusa("proibido", "Só um administrador altera o prazo.");
        if (acao.prazo === t.prazo) throw recusa("conflito", "O prazo já é esse.");
        await query(`update tarefa_operacional set prazo = $1 where id = $2`, [acao.prazo, t.id], c);
        await historico("prazo_alterado", `De ${t.prazo.split("-").reverse().join("/")} para ${acao.prazo.split("-").reverse().join("/")}.`);
        return { ok: true, status: t.status };
      }
      case "cancelar": {
        if (!ehAdmin(leitor)) throw recusa("proibido", "Só um administrador cancela tarefa.");
        await query(`update tarefa_operacional set status = 'cancelada', observacao = $1 where id = $2`, [acao.motivo, t.id], c);
        await historico("cancelada", acao.motivo);
        return { ok: true, status: "cancelada" };
      }
    }
  };
  try {
    return await (executor ? fazer(executor) : withTransaction(fazer));
  } catch (erro) {
    if (erro instanceof Recusa) return erro.r;
    throw erro;
  }
}

/**
 * Conclusão AUTOMÁTICA da implantação pela integração com o Educa (o
 * município foi provisionado lá). Autor nulo no histórico = "integração
 * Educa". Sem tarefa aberta → não faz nada (devolve false).
 */
export async function concluirImplantacaoPelaIntegracao(clienteId: string, executor?: Executor): Promise<boolean> {
  const fazer = async (c: Executor) => {
    const [t] = await query<{ id: string }>(
      `update tarefa_operacional set status = 'concluida', concluida_em = now(), concluida_por = null,
         observacao = coalesce(observacao, 'Concluída automaticamente pela integração com o Educa.')
       where cliente_id = $1 and tipo = 'implantacao' and status in ('aberta', 'em_andamento') returning id`,
      [clienteId],
      c
    );
    if (!t) return false;
    await query(`insert into tarefa_historico (tarefa_id, acao, autor_id, detalhe) values ($1, 'concluida', null, $2)`, [t.id, "Concluída automaticamente: integração Educa (município provisionado)."], c);
    return true;
  };
  return executor ? fazer(executor) : withTransaction(fazer);
}
