// Visões salvas do CRM (rodada 16-A2): a pessoa salva a combinação de
// filtros de uma tela (Território, lista de leads, tela da entidade) com um
// nome e reabre com um clique. CADA PESSOA VÊ SÓ AS SUAS: toda leitura e
// exclusão filtra por usuario_id no SQL (visão de outra pessoa = "não
// existe" → 404). No máximo LIMITE_VISOES por pessoa; nome único por pessoa
// (índice da 0016 → 409).
//
// Os filtros são guardados como os parâmetros da URL da tela (só os que a
// tela entende). Filtro salvo que hoje aponta pra entidade removida ou
// estado não liberado NÃO quebra a tela: ao reabrir, a tela ignora com aviso
// (lib/territorio.ts#sanearFiltros).

import { query, withTransaction, type Executor } from "./db";

import type { TelaVisao } from "./territorio";

export { TELAS_VISAO, type TelaVisao } from "./territorio";
export const LIMITE_VISOES = 30;

export interface VisaoSalva {
  id: string;
  nome: string;
  tela: TelaVisao;
  filtros: Record<string, string>;
  criado_em: string;
}

export async function listarVisoes(usuarioId: string, tela?: TelaVisao, executor?: Executor): Promise<VisaoSalva[]> {
  return query<VisaoSalva>(
    `select id, nome, tela, filtros, criado_em from crm_visao_salva where usuario_id = $1 and ($2::text is null or tela = $2) order by nome`,
    [usuarioId, tela ?? null],
    executor
  );
}

export type ResultadoVisao<T = object> = ({ ok: true } & T) | { ok: false; motivo: "nao_encontrado" } | { ok: false; motivo: "conflito"; erro: string };

export async function salvarVisao(usuarioId: string, v: { nome: string; tela: TelaVisao; filtros: Record<string, string> }, executor?: Executor): Promise<ResultadoVisao<{ id: string }>> {
  const gravar = async (c: Executor): Promise<ResultadoVisao<{ id: string }>> => {
    // Trava a linha da pessoa: duas abas salvando ao mesmo tempo não passam do limite contando a mesma coisa.
    await query(`select 1 from equipe_nexaigen where id = $1 for update`, [usuarioId], c);
    const [{ n }] = await query<{ n: number }>(`select count(*)::int as n from crm_visao_salva where usuario_id = $1`, [usuarioId], c);
    if (n >= LIMITE_VISOES) return { ok: false, motivo: "conflito", erro: `Você já tem ${LIMITE_VISOES} visões salvas — exclua uma antes de salvar outra.` };
    const [linha] = await query<{ id: string }>(
      `insert into crm_visao_salva (usuario_id, nome, tela, filtros) values ($1, $2, $3, $4::jsonb) returning id`,
      [usuarioId, v.nome, v.tela, JSON.stringify(v.filtros)],
      c
    );
    return { ok: true, id: linha.id };
  };
  try {
    return await (executor ? gravar(executor) : withTransaction(gravar));
  } catch (erro) {
    const pg = erro as { code?: string; constraint?: string };
    if (pg?.code === "23505" && pg.constraint === "uq_crm_visao_usuario_nome") return { ok: false, motivo: "conflito", erro: "Você já tem uma visão com esse nome." };
    throw erro;
  }
}

export async function excluirVisao(usuarioId: string, id: string, executor?: Executor): Promise<ResultadoVisao> {
  const linhas = await query(`delete from crm_visao_salva where id = $1 and usuario_id = $2 returning id`, [id, usuarioId], executor);
  return linhas.length ? { ok: true } : { ok: false, motivo: "nao_encontrado" };
}
