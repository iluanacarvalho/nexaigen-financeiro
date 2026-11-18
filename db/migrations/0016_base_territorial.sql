-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0016_base_territorial.sql
--
-- BASE TERRITORIAL do comercial (rodada 16-A2): todas as prefeituras de um
-- estado, as entidades intermunicipais (associações de municípios,
-- consórcios…) a que pertencem e o status comercial de cada uma.
-- Regras puras: lib/territorio.ts; leitura: lib/territorioRepositorio.ts.
--
-- municipio_base — os municípios do IBGE (dado PÚBLICO), carregados por
--   `npm run importar-municipios -- <UF>` a partir de
--   scripts/dados/municipios-<UF>.json (commitado; gerado por
--   scripts/gerar-base-municipios.ts). Upsert idempotente, NUNCA apaga.
--   nome_busca = nome normalizado (sem acento/caixa — lib/ibge.ts
--   #nomeDeMunicipioNormalizado), gravado pela aplicação, como lead.nome_busca.
--
-- estado_comercial — quais UFs o comercial já trabalha. Vendas só vê no
--   Território os estados LIBERADOS; admin vê todos e libera/bloqueia pela
--   tela (/crm/estados). EM PRODUÇÃO a liberação é SEMPRE ato do admin: o
--   seed abaixo (PR liberado) só roda quando o migrador declara ambiente de
--   desenvolvimento (scripts/aplicarMigracoes.ts liga
--   `nexaigen.ambiente_desenvolvimento` só pra banco em localhost).
--
-- entidade_intermunicipal / entidade_membro — associações e consórcios e
--   seus municípios (um município pode estar em várias). Dados reais vêm por
--   CSV (scripts/importar-entidades-csv.ts) ou pela tela do admin — fonte
--   (fonte_url) e data de verificação são obrigatórias. Nada de entidade
--   real é inventado nesta migration. Entidade "removida" = ativo false
--   (nunca DELETE: visões salvas e histórico podem apontar pra ela).
--
-- crm_visao_salva — filtros salvos por pessoa (Território, lista de leads,
--   tela da entidade). Cada pessoa vê só as suas; limite por pessoa no
--   serviço (lib/visoesServico.ts).
--
-- lead_interacao ganha o tipo 'criacao' (lead aberto pelo Território, um a
--   um ou em lote — o histórico registra de onde veio).
--
-- Vínculo com o existente: cliente_prefeitura.codigo_ibge e
--   lead.codigo_ibge casam com municipio_base.codigo_ibge SEM FK (clientes
--   e leads antigos podem não ter código). Nenhum dado existente é alterado.
--
-- Idempotente: rodar de novo não muda nada nem dá erro.
-- =====================================================================

create table if not exists municipio_base (
  codigo_ibge text primary key check (codigo_ibge ~ '^[0-9]{7}$'),
  nome text not null check (char_length(btrim(nome)) between 2 and 200),
  nome_busca text not null check (char_length(nome_busca) between 1 and 200),
  uf char(2) not null check (uf in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  populacao integer check (populacao >= 0),
  populacao_ano integer check (populacao_ano between 1872 and 2200),
  microrregiao text check (char_length(microrregiao) <= 200),
  mesorregiao text check (char_length(mesorregiao) <= 200),
  atualizado_em timestamptz not null default now(),
  constraint ck_municipio_base_populacao_ano check (populacao is null or populacao_ano is not null)
);
create index if not exists idx_municipio_base_uf on municipio_base (uf);
create index if not exists idx_municipio_base_nome_busca on municipio_base (uf, nome_busca);

create table if not exists estado_comercial (
  uf char(2) primary key check (uf in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  liberado boolean not null default false,
  liberado_em timestamptz,
  liberado_por uuid references equipe_nexaigen (id),
  constraint ck_estado_comercial_liberado_em check (not liberado or liberado_em is not null)
);

create table if not exists entidade_intermunicipal (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 2 and 200),
  sigla text check (char_length(sigla) between 1 and 30),
  tipo text not null check (tipo in ('associacao_municipios', 'consorcio_intermunicipal', 'associacao_regional', 'outro')),
  uf char(2) check (uf in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  site text check (char_length(site) <= 300 and site ~ '^https?://'),
  contato_nome text check (char_length(contato_nome) <= 200),
  contato_email text check (char_length(contato_email) <= 254 and contato_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  contato_telefone text check (char_length(contato_telefone) <= 40),
  observacao text check (char_length(observacao) <= 1000),
  fonte_url text not null check (char_length(fonte_url) <= 500 and fonte_url ~ '^https?://'),
  verificado_em date not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- UNIQUE por (lower(nome), uf) — uf nula conta como um valor ('' ), senão duas entidades sem UF com o mesmo nome passariam.
create unique index if not exists uq_entidade_nome_uf on entidade_intermunicipal (lower(nome), coalesce(uf::text, ''));

create table if not exists entidade_membro (
  entidade_id uuid not null references entidade_intermunicipal (id),
  codigo_ibge text not null references municipio_base (codigo_ibge),
  desde date,
  primary key (entidade_id, codigo_ibge)
);
create index if not exists idx_entidade_membro_codigo on entidade_membro (codigo_ibge);

create table if not exists crm_visao_salva (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references equipe_nexaigen (id),
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  tela text not null check (tela in ('territorio', 'leads', 'entidade')),
  filtros jsonb not null check (jsonb_typeof(filtros) = 'object'),
  criado_em timestamptz not null default now(),
  constraint uq_crm_visao_usuario_nome unique (usuario_id, nome)
);

-- Vínculo por código IBGE (sem FK). cliente_prefeitura já tem o índice único parcial da 0013.
create index if not exists idx_lead_codigo_ibge on lead (codigo_ibge) where codigo_ibge is not null;

-- lead_interacao: + tipo 'criacao'. O CHECK original (inline na 0014) não tem nome próprio — troca pelo nomeado.
do $$
declare
  restricao record;
begin
  for restricao in
    select conname from pg_constraint
    where conrelid = 'lead_interacao'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ~ '\mtipo\M'
      and conname <> 'ck_lead_interacao_tipo'
  loop
    execute format('alter table lead_interacao drop constraint %I', restricao.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'ck_lead_interacao_tipo') then
    alter table lead_interacao add constraint ck_lead_interacao_tipo
      check (tipo in ('nota', 'ligacao', 'email', 'reuniao', 'whatsapp', 'visita', 'mudanca_etapa', 'troca_vendedor', 'edicao', 'reabertura', 'criacao'));
  end if;
end;
$$;

-- Seed de DESENVOLVIMENTO: PR liberado. Em produção o migrador não declara o ambiente → nada é liberado aqui.
do $$
begin
  if current_setting('nexaigen.ambiente_desenvolvimento', true) = 'sim' then
    insert into estado_comercial (uf, liberado, liberado_em) values ('PR', true, now()) on conflict (uf) do nothing;
  end if;
end;
$$;
