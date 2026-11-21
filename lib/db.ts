// Único ponto de acesso ao Postgres — Postgres DIRETO via "pg", substitui
// o Supabase (rodada de migração de infraestrutura, pedido explícito da
// Luana: mesma arquitetura de banco do projeto irmão nexaigen-educa, sem
// depender de um projeto Supabase configurado à parte — foi exatamente
// isso que bloqueou o primeiro login real, um projeto Supabase antigo e
// esquecido com a URL nunca preenchida). Mesmo contrato de
// nexaigen-educa/lib/db.ts: Pool cacheado em globalThis, `query()`
// parametrizada, `withTransaction()` pra atomicidade. Este projeto é
// mono-tenant e não tem camada de repositórios própria — toda rota já
// chamava `supabaseAdmin()` direto, então continua chamando `query()`/
// `withTransaction()` direto, sem introduzir uma camada nova só por
// causa desta migração.

import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

// --- Type parsers — preservam o MESMO formato que o cliente Supabase já
// devolvia, decisão explícita desta rodada ("migração de infraestrutura,
// não de funcionalidade": nenhum campo/formato de resposta muda). Sem
// isto, o driver "pg" (que não sabe nada sobre como o PostgREST do
// Supabase formatava esses tipos) devolveria valores num formato
// DIFERENTE do que o frontend/os testes já esperam — uma regressão de
// comportamento visível, não só um detalhe interno.
//
// Avaliado lendo os tipos usados em lib/auth.ts e nas rotas atuais
// (nenhuma suposição): três tipos precisavam de ajuste, um NÃO precisava.
//
// 1) bigint/int8 (oid 20) — `equipe_nexaigen.token_version`, o ÚNICO
//    bigint do schema. O driver "pg" devolve int8 como STRING por padrão
//    (evita perda de precisão acima de Number.MAX_SAFE_INTEGER) — mas o
//    Supabase/PostgREST devolve int8 como NÚMERO. Isso importa de
//    verdade: lib/auth.ts#obterContextoAutenticado compara
//    `data.token_version !== claims.token_version` (claims vem de JWT,
//    sempre number) — sem este parser, "3" !== 3 seria sempre true,
//    quebrando TODO login (toda sessão pareceria invalidada). Convertido
//    pra Number aqui — seguro neste schema porque o único uso de
//    token_version é Date.now() (13 dígitos), bem abaixo de
//    Number.MAX_SAFE_INTEGER (16 dígitos) — não é uma conversão genérica
//    seguininforme, é uma decisão específica pra ESTE dado.
types.setTypeParser(20, (valor) => Number(valor));

// 2) date (oid 1082) — nota_fiscal.data_emissao/data_atesto/
//    data_limite_pagamento/data_pagamento. O driver "pg" por padrão
//    devolve `date` como objeto Date (à meia-noite, com risco conhecido
//    de troca de dia dependendo do fuso do processo) — o Supabase
//    devolve a STRING "aaaa-mm-dd" crua. Isso é visível de verdade:
//    app/(protegido)/checagem interpola `data_emissao` direto no texto
//    (`emitida em {n.data_emissao}`) — virar um Date serializado mudaria
//    o texto exibido de "2026-08-01" pra "2026-08-01T00:00:00.000Z".
//    Como o Postgres já manda a data em texto plano no protocolo, o
//    parser aqui simplesmente devolve o valor CRU recebido, sem
//    conversão nenhuma — bate exatamente com o formato do Supabase.
types.setTypeParser(1082, (valor) => valor);

// 3) timestamptz (oid 1184) — equipe_nexaigen.criado_em/atualizado_em,
//    cliente_prefeitura/nota_fiscal.created_at, alerta_cobranca.gerado_em/
//    resolvido_em, evento_verificacao.data_verificacao. Mesmo parser (e
//    mesmo raciocínio) de nexaigen-educa/lib/db.ts: o driver "pg" devolve
//    um objeto Date por padrão; convertido aqui pra string ISO 8601
//    completa, batendo com o formato que o Supabase já devolvia.
types.setTypeParser(1184, (valor) => new Date(valor).toISOString());

// 4) numeric (oid 1700) — cliente_prefeitura.valor_mensal, nota_fiscal.valor.
//    NENHUM parser necessário — o driver "pg" já devolve numeric como
//    STRING por padrão (evita perda de precisão de ponto flutuante em
//    dinheiro), exatamente como o Supabase/PostgREST já fazia. Confirmado
//    lendo o frontend atual: toda leitura desses campos já envolve
//    `Number(c.valor_mensal)`/`Number(n.valor)` explícito (app/(protegido)/
//    clientes, checagem, alertas, page.tsx) — o código já esperava uma
//    string vinda do servidor, não um number pronto. Comportamento
//    idêntico sem nenhuma mudança aqui.

declare global {
  var __nexaigenFinPgPool: Pool | undefined;
}

function criarPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não configurada.");
  }
  return new Pool({ connectionString, max: 10 });
}

// Cacheia o pool em globalThis sempre — evita vazar conexões em
// hot-reload do Next dev (cada reload de módulo recriaria um Pool novo
// sem isto). Mesmo raciocínio de nexaigen-educa/lib/db.ts.
const pool = globalThis.__nexaigenFinPgPool ?? criarPool();
globalThis.__nexaigenFinPgPool = pool;

/**
 * Qualquer coisa que sabe rodar `.query(sql, params)` — o pool inteiro ou
 * um único `PoolClient` emprestado por `withTransaction`. Permite que uma
 * chamada participe de uma transação já aberta em vez de sempre pegar uma
 * conexão nova do pool.
 */
export type Executor = Pick<Pool | PoolClient, "query">;

/** Executa SQL parametrizado ($1, $2...) contra o Postgres. Nunca interpolar valores na string. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  executor: Executor = pool
): Promise<T[]> {
  const resultado = await executor.query<T>(sql, params);
  return resultado.rows;
}

/**
 * Várias leituras independentes: EM PARALELO no pool (cada uma pega a sua
 * conexão); EM SEQUÊNCIA quando `executor` é um client de transação — uma
 * conexão só executa uma consulta por vez (o driver "pg" ainda enfileira, mas
 * avisa que deixa de aceitar no pg@9: "Calling client.query() when the client
 * is already executing a query"). Rodada 16-A3: o lote do Território lê
 * dentro da transação e disparava esse aviso.
 */
export async function consultasJuntas<R extends readonly unknown[]>(
  executor: Executor | undefined,
  tarefas: readonly [...{ [K in keyof R]: () => Promise<R[K]> }]
): Promise<R> {
  const chamar = (t: unknown) => (t as () => Promise<unknown>)();
  if (executor === undefined || executor === pool) return (await Promise.all(tarefas.map(chamar))) as unknown as R;
  const resultados: unknown[] = [];
  for (const tarefa of tarefas) resultados.push(await chamar(tarefa));
  return resultados as unknown as R;
}

/**
 * Empresta UM client do pool pra `fn` rodar tudo dentro da MESMA
 * transação/conexão — necessário sempre que duas ou mais queries
 * precisam ser atômicas entre si.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const resultado = await fn(client);
    await client.query("commit");
    return resultado;
  } catch (erro) {
    await client.query("rollback");
    throw erro;
  } finally {
    client.release();
  }
}
