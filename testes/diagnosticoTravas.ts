// Helper SÓ de teste de integração (rodada 16-A3): quem está segurando trava
// no Postgres? Usado pelo setup da suíte de integração
// (vitest.integration.setup.ts) quando um teste falha por trava (lock_timeout
// de 5 s / tempo esgotado), e pra conferir no fim de cada arquivo que ele não
// deixou sessão "idle in transaction".
//
// Abre uma conexão PRÓPRIA (fora do pool da aplicação), só de leitura de
// catálogo (pg_stat_activity / pg_locks), e fecha em seguida. Nunca imprime
// a URL do banco.

import { Client } from "pg";

async function comConexao<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url, application_name: "teste:diagnostico-travas" });
  c.on("error", () => undefined); // conexão curta, só leitura de catálogo: queda vira erro da consulta, nunca exceção solta (16-A4)
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export interface SessaoSuspeita {
  pid: number;
  aplicacao: string;
  banco: string | null;
  estado: string | null;
  transacao_ha_segundos: number | null;
  esperando: string | null;
  bloqueada_por: number[];
  travas: string | null;
  consulta: string | null;
}

/**
 * Sessões do servidor inteiro (todas as bases) que estão esperando trava,
 * bloqueando alguém, "idle in transaction", ou com transação aberta há mais
 * de 1 s — com as travas de tabela que seguram. A própria conexão de
 * diagnóstico fica de fora.
 */
export async function sessoesSuspeitas(url: string): Promise<SessaoSuspeita[]> {
  return comConexao(url, async (c) => {
    const { rows } = await c.query<SessaoSuspeita>(`
      select a.pid, coalesce(nullif(a.application_name, ''), '(sem nome)') as aplicacao, a.datname as banco, a.state as estado,
             extract(epoch from now() - a.xact_start)::int as transacao_ha_segundos,
             case when a.wait_event_type = 'Lock' then a.wait_event end as esperando,
             pg_blocking_pids(a.pid) as bloqueada_por,
             (select string_agg(distinct
                 case when l.relation is null then l.locktype
                      when l.database = (select oid from pg_database where datname = current_database()) then l.relation::regclass::text
                      else 'tabela oid ' || l.relation || ' (de outra base)' end
                 || ':' || l.mode || case when l.granted then '' else ' (aguardando)' end, ', ')
                from pg_locks l where l.pid = a.pid and l.locktype in ('relation', 'transactionid')) as travas,
             left(regexp_replace(a.query, '\\s+', ' ', 'g'), 200) as consulta
      from pg_stat_activity a
      where a.pid <> pg_backend_pid() and a.backend_type = 'client backend'
        and (a.wait_event_type = 'Lock'
             or a.state like 'idle in transaction%'
             or cardinality(pg_blocking_pids(a.pid)) > 0
             or a.pid in (select unnest(pg_blocking_pids(b.pid)) from pg_stat_activity b)
             or (a.xact_start is not null and now() - a.xact_start > interval '1 second'))
      order by a.xact_start nulls last`);
    return rows;
  });
}

/** Sessões "idle in transaction" com este application_name (um arquivo de teste que esqueceu uma transação aberta). */
export async function sessoesOciosasEmTransacao(url: string, aplicacao: string): Promise<{ pid: number; consulta: string | null }[]> {
  return comConexao(url, async (c) => {
    const { rows } = await c.query<{ pid: number; consulta: string | null }>(
      `select pid, left(regexp_replace(query, '\\s+', ' ', 'g'), 200) as consulta from pg_stat_activity
       where application_name = $1 and state like 'idle in transaction%' and pid <> pg_backend_pid()`,
      [aplicacao]
    );
    return rows;
  });
}

export function relatorioSessoes(sessoes: SessaoSuspeita[]): string {
  if (sessoes.length === 0) return "  (nenhuma sessão esperando trava, bloqueando ou com transação aberta agora)";
  return sessoes
    .map(
      (s) =>
        `  pid ${s.pid} · ${s.aplicacao} · banco ${s.banco ?? "—"} · ${s.estado ?? "—"}` +
        (s.transacao_ha_segundos !== null ? ` · transação aberta há ${s.transacao_ha_segundos}s` : "") +
        (s.esperando ? ` · ESPERANDO trava (${s.esperando}) de pid ${s.bloqueada_por.join(", ")}` : "") +
        (s.travas ? `\n      travas: ${s.travas}` : "") +
        (s.consulta ? `\n      última consulta: ${s.consulta}` : "")
    )
    .join("\n");
}
