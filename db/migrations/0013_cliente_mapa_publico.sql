-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0013_cliente_mapa_publico.sql
--
-- Mapa PÚBLICO das prefeituras atendidas (rodada 15-B). Mostrar o nome de
-- um cliente no site é exposição pública — a regra central: SÓ aparece
-- quem AUTORIZOU por escrito (cláusula de divulgação), e o endpoint
-- público (GET /api/publico/mapa-clientes) nunca devolve nada além de
-- nome, UF e posição. Regras puras: lib/mapaPublico.ts; escrita:
-- lib/divulgacaoServico.ts.
--
-- (a) codigo_ibge: código de 7 dígitos do município (IBGE), único entre
--     os clientes (uma prefeitura por município).
-- (b) latitude/longitude: centroide do município, calculado UMA vez a
--     partir da malha do IBGE quando a equipe grava o código
--     (lib/ibge.ts) — o endpoint público só lê o que está aqui, nunca
--     chama o IBGE. Os dois juntos (ou nenhum: "posição pendente"), dentro
--     da faixa do território brasileiro.
-- (c) autorizacao_divulgacao (default false — NENHUM cliente existente
--     aparece sem ação explícita) + quando e por quem. O banco garante:
--     autorizado ⇒ código, posição e data preenchidos.
-- (d) cliente_evento_contrato ganha os tipos 'divulgacao_autorizada' e
--     'divulgacao_revogada' (trilha de quem fez e quando). O CHECK de tipo
--     era inline na 0011 (o Postgres o nomeou
--     cliente_evento_contrato_tipo_check) — não assumimos o nome: o bloco
--     abaixo procura no catálogo o CHECK que menciona a coluna tipo e o
--     troca por um nomeado. ATENÇÃO pra quem lê a trilha: a lógica de
--     contrato (aviso prévio, retratação, relatório) olha SÓ os 3 tipos de
--     contrato (TIPOS_EVENTO_CONTRATO em lib/cancelamentoServico.ts).
--
-- Idempotente: rodar de novo não muda nada nem dá erro.
-- =====================================================================

alter table cliente_prefeitura
  add column if not exists codigo_ibge text,
  add column if not exists latitude numeric(9, 6),
  add column if not exists longitude numeric(9, 6),
  add column if not exists autorizacao_divulgacao boolean not null default false,
  add column if not exists autorizacao_divulgacao_em timestamptz,
  add column if not exists autorizacao_divulgacao_por uuid references equipe_nexaigen (id);

create unique index if not exists uq_cliente_prefeitura_codigo_ibge
  on cliente_prefeitura (codigo_ibge)
  where codigo_ibge is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_codigo_ibge_formato') then
    alter table cliente_prefeitura
      add constraint ck_cliente_prefeitura_codigo_ibge_formato check (codigo_ibge is null or codigo_ibge ~ '^[0-9]{7}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_posicao_par') then
    alter table cliente_prefeitura
      add constraint ck_cliente_prefeitura_posicao_par check ((latitude is null) = (longitude is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_posicao_brasil') then
    alter table cliente_prefeitura
      add constraint ck_cliente_prefeitura_posicao_brasil check (
        (latitude is null or latitude between -34 and 6)
        and (longitude is null or longitude between -74 and -28)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_divulgacao_requisitos') then
    alter table cliente_prefeitura
      add constraint ck_cliente_prefeitura_divulgacao_requisitos check (
        not autorizacao_divulgacao
        or (codigo_ibge is not null and latitude is not null and longitude is not null and autorizacao_divulgacao_em is not null)
      );
  end if;
end;
$$;

do $$
declare
  restricao record;
begin
  for restricao in
    select conname
    from pg_constraint
    where conrelid = 'cliente_evento_contrato'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~ '\mtipo\M'
      and conname <> 'ck_cliente_evento_contrato_tipo'
  loop
    execute format('alter table cliente_evento_contrato drop constraint %I', restricao.conname);
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_evento_contrato_tipo') then
    alter table cliente_evento_contrato
      add constraint ck_cliente_evento_contrato_tipo check (
        tipo in ('cancelamento_registrado', 'cancelamento_retratado', 'contrato_encerrado', 'divulgacao_autorizada', 'divulgacao_revogada')
      );
  end if;
end;
$$;
