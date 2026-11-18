// Escrita das entidades intermunicipais e dos estados comerciais (rodada
// 16-A2). SÓ ADMIN (as rotas exigem a área crm_gestao). Fonte (URL) e data
// de verificação são obrigatórias (schema + NOT NULL no banco); data no
// futuro é recusada aqui (precisa de "hoje").
//
// Entidade nunca é apagada: "remover" = ativo false (visões salvas e
// históricos podem apontar pra ela). Membro sai com DELETE (é só o vínculo).
//
// importarEntidadesCsv: o CSV inteiro numa transação — o arquivo já chegou
// validado (lib/entidadesCsv.ts); qualquer erro de banco desfaz TUDO.
// Reimportar ATUALIZA a entidade (mesmo nome + UF) e acrescenta membros
// novos — nunca duplica e nunca remove membro (remoção é pela tela).

import { query, withTransaction, type Executor } from "./db";
import type { EntidadeCampos } from "./entidadeSchemas";
import type { EntidadeDoCsv } from "./entidadesCsv";

export type ResultadoEntidade<T = object> =
  | ({ ok: true } & T)
  | { ok: false; motivo: "nao_encontrado" }
  | { ok: false; motivo: "conflito" | "dados_invalidos"; erro: string; campo?: string };

const CAMPOS = ["nome", "sigla", "tipo", "uf", "site", "contato_nome", "contato_email", "contato_telefone", "observacao", "fonte_url", "verificado_em"] as const satisfies readonly (keyof EntidadeCampos)[];

export const MENSAGEM_ENTIDADE_DUPLICADA = "Já existe uma entidade com este nome nesta UF.";
const VERIFICACAO_NO_FUTURO = "A data da verificação não pode estar no futuro.";

function traduzirErro(erro: unknown): ResultadoEntidade<never> {
  const pg = erro as { code?: string; constraint?: string };
  if (pg?.code === "23505" && pg.constraint === "uq_entidade_nome_uf") return { ok: false, motivo: "conflito", erro: MENSAGEM_ENTIDADE_DUPLICADA };
  throw erro;
}

export async function criarEntidade(campos: EntidadeCampos, hoje: string, executor?: Executor): Promise<ResultadoEntidade<{ id: string }>> {
  if (campos.verificado_em > hoje) return { ok: false, motivo: "dados_invalidos", campo: "verificado_em", erro: VERIFICACAO_NO_FUTURO };
  try {
    const [linha] = await query<{ id: string }>(
      `insert into entidade_intermunicipal (${CAMPOS.join(", ")}) values (${CAMPOS.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      CAMPOS.map((c) => campos[c]),
      executor
    );
    return { ok: true, id: linha.id };
  } catch (erro) {
    return traduzirErro(erro);
  }
}

export async function editarEntidade(id: string, campos: Partial<EntidadeCampos & { ativo: boolean }>, hoje: string, executor?: Executor): Promise<ResultadoEntidade> {
  if (campos.verificado_em !== undefined && campos.verificado_em > hoje) return { ok: false, motivo: "dados_invalidos", campo: "verificado_em", erro: VERIFICACAO_NO_FUTURO };
  const colunas = ([...CAMPOS, "ativo"] as const).filter((c) => campos[c] !== undefined);
  try {
    const linhas = await query<{ id: string }>(
      `update entidade_intermunicipal set ${colunas.map((c, i) => `${c} = $${i + 2}`).join(", ")}, atualizado_em = now() where id = $1 returning id`,
      [id, ...colunas.map((c) => campos[c])],
      executor
    );
    return linhas.length ? { ok: true } : { ok: false, motivo: "nao_encontrado" };
  } catch (erro) {
    return traduzirErro(erro);
  }
}

export async function adicionarMembro(id: string, codigoIbge: string, desde: string | null, executor?: Executor): Promise<ResultadoEntidade> {
  const [entidade] = await query<{ id: string }>(`select id from entidade_intermunicipal where id = $1`, [id], executor);
  if (!entidade) return { ok: false, motivo: "nao_encontrado" };
  const [municipio] = await query<{ codigo_ibge: string }>(`select codigo_ibge from municipio_base where codigo_ibge = $1`, [codigoIbge], executor);
  if (!municipio) return { ok: false, motivo: "dados_invalidos", campo: "codigo_ibge", erro: "Município não está na base (importe o estado antes)." };
  const linhas = await query(`insert into entidade_membro (entidade_id, codigo_ibge, desde) values ($1, $2, $3) on conflict do nothing returning entidade_id`, [id, codigoIbge, desde], executor);
  if (linhas.length === 0) return { ok: false, motivo: "conflito", erro: "Este município já é membro da entidade." };
  await query(`update entidade_intermunicipal set atualizado_em = now() where id = $1`, [id], executor);
  return { ok: true };
}

export async function removerMembro(id: string, codigoIbge: string, executor?: Executor): Promise<ResultadoEntidade> {
  const linhas = await query(`delete from entidade_membro where entidade_id = $1 and codigo_ibge = $2 returning entidade_id`, [id, codigoIbge], executor);
  if (linhas.length === 0) return { ok: false, motivo: "nao_encontrado" };
  await query(`update entidade_intermunicipal set atualizado_em = now() where id = $1`, [id], executor);
  return { ok: true };
}

export interface ResultadoImportacaoEntidades {
  entidadesCriadas: number;
  entidadesAtualizadas: number;
  entidadesSemMudanca: number;
  membrosNovos: number;
  membrosJaExistentes: number;
}

/** Grava as entidades JÁ VALIDADAS do CSV numa transação (tudo ou nada). */
export async function importarEntidadesCsv(entidades: EntidadeDoCsv[], executor?: Executor): Promise<ResultadoImportacaoEntidades> {
  const gravar = async (c: Executor) => {
    const r: ResultadoImportacaoEntidades = { entidadesCriadas: 0, entidadesAtualizadas: 0, entidadesSemMudanca: 0, membrosNovos: 0, membrosJaExistentes: 0 };
    for (const e of entidades) {
      const valores = CAMPOS.map((col) => e[col]);
      const [gravada] = await query<{ id: string; inserida: boolean }>(
        `insert into entidade_intermunicipal (${CAMPOS.join(", ")}) values (${CAMPOS.map((_, i) => `$${i + 1}`).join(", ")})
         on conflict (lower(nome), coalesce(uf::text, '')) do update set
           ${CAMPOS.map((col) => `${col} = excluded.${col}`).join(", ")}, atualizado_em = now()
         where (${CAMPOS.map((col) => `entidade_intermunicipal.${col}`).join(", ")}) is distinct from (${CAMPOS.map((col) => `excluded.${col}`).join(", ")})
         returning id, (xmax = 0) as inserida`,
        valores,
        c
      );
      let id = gravada?.id;
      if (!gravada) {
        r.entidadesSemMudanca++;
        [{ id }] = await query<{ id: string }>(`select id from entidade_intermunicipal where lower(nome) = lower($1) and coalesce(uf::text, '') = coalesce($2::text, '')`, [e.nome, e.uf], c);
      } else if (gravada.inserida) r.entidadesCriadas++;
      else r.entidadesAtualizadas++;
      if (e.membros.length) {
        const novos = await query(
          `insert into entidade_membro (entidade_id, codigo_ibge) select $1, unnest($2::text[]) on conflict do nothing returning codigo_ibge`,
          [id, e.membros],
          c
        );
        r.membrosNovos += novos.length;
        r.membrosJaExistentes += e.membros.length - novos.length;
      }
    }
    return r;
  };
  return executor ? gravar(executor) : withTransaction(gravar);
}

/** Códigos que existem na base (pra validação do CSV). */
export async function codigosNaBase(codigos: string[], executor?: Executor): Promise<Set<string>> {
  if (codigos.length === 0) return new Set();
  const linhas = await query<{ codigo_ibge: string }>(`select codigo_ibge from municipio_base where codigo_ibge = any($1::text[])`, [codigos], executor);
  return new Set(linhas.map((l) => l.codigo_ibge));
}

/** Libera/bloqueia um estado pro comercial (só admin). Guarda quem liberou e quando; bloquear limpa os dois (vale o estado atual). */
export async function liberarEstado(uf: string, liberado: boolean, adminId: string, executor?: Executor): Promise<void> {
  await query(
    `insert into estado_comercial (uf, liberado, liberado_em, liberado_por) values ($1, $2, case when $2 then now() end, case when $2 then $3::uuid end)
     on conflict (uf) do update set liberado = excluded.liberado, liberado_em = excluded.liberado_em, liberado_por = excluded.liberado_por`,
    [uf, liberado, adminId],
    executor
  );
}
