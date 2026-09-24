-- =====================================================================
-- NEXAIGEN FINANCEIRO — Schema
-- Uso interno da NEXAIGEN para controlar contratos com prefeituras-cliente,
-- emissão/atesto/pagamento de notas fiscais, e escalonamento de cobrança.
-- Este banco é MONO-TENANT (é o negócio da NEXAIGEN controlando todos os
-- clientes) — não confundir com o schema multi-tenant de nexaigen-educa,
-- que é o produto vendido a cada prefeitura.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. EQUIPE NEXAIGEN (login próprio) — substitui `usuario_interno`
-- ---------------------------------------------------------------------
-- ACHADO CRÍTICO DE SEGURANÇA (rodada de correção): `usuario_interno` era
-- pensada pra guardar quem é da equipe, mas NUNCA foi lida/checada em
-- lugar nenhum do código da aplicação — confirmado por busca no repo
-- inteiro (grep por "usuario_interno" em app/**, lib/** antes desta
-- rodada: zero ocorrências fora deste próprio arquivo). Toda rota de API
-- (/api/clientes, /api/notas, /api/alertas) e toda página estava
-- COMPLETAMENTE aberta, sem verificação de sessão nenhuma — o mecanismo
-- de auth planejado (Supabase Auth + `usuario_interno` + RLS via
-- `auth.uid()`) nunca foi de fato conectado a um fluxo de login real
-- (não existia tela de login nem chamada a `supabase.auth.signIn*` em
-- lugar nenhum do projeto).
--
-- Substituído por login PRÓPRIO (bcrypt + JWT via `lib/auth.ts`, mesmo
-- espírito do login de equipe do projeto irmão nexaigen-educa, mas SEM
-- multi-tenant — este projeto só tem um tipo de usuário, sem papel, sem
-- hierarquia: qualquer pessoa da equipe logada pode cadastrar outra).
-- `equipe_nexaigen` guarda a própria credencial (`senha_hash`, nunca em
-- texto puro) — diferente de `usuario_interno`, que dependia inteiramente
-- do Supabase Auth (nenhuma senha própria, só o vínculo com `auth.users`)
-- e por isso nunca funcionou sozinha.
create table if not exists equipe_nexaigen (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text not null constraint equipe_nexaigen_email_unico unique,
  senha_hash text not null,
  -- true por padrão: toda conta nasce de POST /api/equipe ou do bootstrap
  -- (scripts/bootstrap-equipe-nexaigen.ts) com senha GERADA, nunca
  -- escolhida pela própria pessoa na criação — força troca no primeiro
  -- acesso (ver lib/auth.ts#trocarSenha).
  senha_temporaria boolean not null default true,
  -- Epoch em milissegundos (não um contador incremental) — trocar a senha
  -- grava Date.now() aqui, o que garante um valor estritamente MAIOR e
  -- DIFERENTE de qualquer token já emitido antes, sem precisar de uma
  -- leitura prévia pra incrementar com segurança (o cliente supabase-js
  -- não faz `set x = x + 1` atomicamente sem uma function/RPC dedicada,
  -- que este projeto não tem — usar um timestamp evita essa necessidade
  -- por construção, não é só um capricho). Ver lib/auth.ts#obterContextoAutenticado:
  -- um access token cujo token_version não bate mais com o valor atual no
  -- banco é tratado como inválido, mesmo ainda dentro dos 15min de vida
  -- do JWT — é o que faz "trocar a senha" invalidar de verdade um token
  -- já emitido, não só sessões futuras.
  token_version bigint not null default 1,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Mesmo formato/contrato de lib/repositorios/sessao.ts do nexaigen-educa
-- — refresh token de alta entropia, só o HASH sha256 gravado, nunca o
-- token puro.
create table if not exists sessao (
  id uuid primary key default gen_random_uuid(),
  equipe_id uuid not null references equipe_nexaigen (id) on delete cascade,
  refresh_token_hash text not null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogado_em timestamptz
);
create index if not exists idx_sessao_equipe on sessao (equipe_id);
create unique index if not exists idx_sessao_refresh_token_hash on sessao (refresh_token_hash);

-- ---------------------------------------------------------------------
-- 2. CLIENTE (prefeitura contratante da NEXAIGEN)
-- ---------------------------------------------------------------------
create table if not exists cliente_prefeitura (
  id uuid primary key default gen_random_uuid(),
  nome text not null,               -- "Prefeitura Municipal de Jaguapitã"
  uf text not null,
  cnpj text,
  plano text not null default 'essencial' check (plano in ('essencial', 'completo')),
  valor_mensal numeric(12, 2) not null,
  dia_vencimento_contrato int not null default 1 check (dia_vencimento_contrato between 1 and 28),
  data_inicio_contrato date not null,
  status_contrato text not null default 'ativo' check (status_contrato in ('ativo', 'suspenso', 'encerrado')),

  -- Onde/como checar o atesto — SEM senha armazenada aqui, de propósito.
  sistema_portal text,              -- ex.: "Betha", "e-Cidade", "Publica"
  portal_url text,
  portal_usuario text,              -- login (não a senha)

  contato_nome text,
  contato_email text,
  contato_telefone text,

  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. NOTA FISCAL
-- ---------------------------------------------------------------------
create table if not exists nota_fiscal (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references cliente_prefeitura (id) on delete cascade,
  competencia date not null,        -- primeiro dia do mês de referência (ex.: 2026-08-01)
  numero_nf text,
  valor numeric(12, 2) not null,

  data_emissao date not null default current_date,
  data_atesto date,                 -- preenchida quando alguém confirma no portal (manual ou futura integração)
  data_limite_pagamento date,       -- gerada por trigger = data_atesto + 30 dias
  data_pagamento date,

  status text not null default 'emitida' check (
    status in ('emitida', 'aguardando_atesto', 'atestada', 'vencida', 'paga', 'atraso_critico', 'cancelada')
  ),

  created_at timestamptz not null default now()
);
create index if not exists idx_nota_cliente on nota_fiscal (cliente_id);
create index if not exists idx_nota_status on nota_fiscal (status);

-- Gera data_limite_pagamento automaticamente quando o atesto é registrado
create or replace function trg_calcular_data_limite() returns trigger
language plpgsql
as $$
begin
  if new.data_atesto is not null then
    new.data_limite_pagamento := new.data_atesto + interval '30 days';
  end if;
  return new;
end;
$$;

drop trigger if exists calcular_data_limite on nota_fiscal;
create trigger calcular_data_limite
  before insert or update on nota_fiscal
  for each row execute function trg_calcular_data_limite();

-- ---------------------------------------------------------------------
-- 4. EVENTO DE VERIFICAÇÃO — histórico de cada checagem manual do portal
-- (a "fila de checagem" registra aqui cada tentativa, não só o resultado final)
-- ---------------------------------------------------------------------
create table if not exists evento_verificacao (
  id uuid primary key default gen_random_uuid(),
  nota_fiscal_id uuid not null references nota_fiscal (id) on delete cascade,
  verificado_por uuid references equipe_nexaigen (id),
  data_verificacao timestamptz not null default now(),
  resultado text not null check (resultado in ('sem_atesto_ainda', 'atestada', 'paga', 'erro_acesso_portal')),
  observacao text
);
create index if not exists idx_verificacao_nota on evento_verificacao (nota_fiscal_id);

-- ---------------------------------------------------------------------
-- 5. ALERTA DE COBRANÇA — escalonamento automático
-- ---------------------------------------------------------------------
create table if not exists alerta_cobranca (
  id uuid primary key default gen_random_uuid(),
  nota_fiscal_id uuid not null references nota_fiscal (id) on delete cascade,
  tipo text not null check (
    tipo in ('sem_atesto_prolongado', 'proximo_vencimento', 'vencido', 'atraso_60_dias')
  ),
  gerado_em timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente', 'em_andamento', 'resolvido')),
  atribuido_a uuid references equipe_nexaigen (id),
  resolvido_em timestamptz,
  observacao text
);
create index if not exists idx_alerta_nota on alerta_cobranca (nota_fiscal_id);
create index if not exists idx_alerta_status on alerta_cobranca (status);

-- Evita duplicar o mesmo tipo de alerta em aberto para a mesma nota
create unique index if not exists uq_alerta_ativo
  on alerta_cobranca (nota_fiscal_id, tipo)
  where status <> 'resolvido';

-- ---------------------------------------------------------------------
-- REMOÇÃO de `usuario_interno` (achado crítico de segurança) — precisa
-- rodar AQUI, depois de cliente_prefeitura/nota_fiscal/evento_verificacao/
-- alerta_cobranca já criadas acima (rodar isto antes delas existirem, num
-- banco novo do zero, falha: "relation does not exist" ao tentar
-- dropar/recriar as policies e FKs que as referenciam — achado real,
-- verificado rodando este arquivo do zero contra um Postgres limpo antes
-- de considerar esta migração pronta).
-- ---------------------------------------------------------------------

-- Remove as policies que dependem de `usuario_interno` ANTES de dropar a
-- tabela — uma policy referenciando uma tabela inexistente na sua
-- subquery quebraria toda leitura/escrita nas 4 tabelas abaixo (a
-- dependência de uma policy não é uma dependência formal do Postgres,
-- `drop table ... cascade` sozinho NÃO limpa isso). Repetir este bloco
-- num banco onde a tabela já foi removida é seguro (`if exists`).
drop policy if exists equipe_acessa_clientes on cliente_prefeitura;
drop policy if exists equipe_acessa_notas on nota_fiscal;
drop policy if exists equipe_acessa_verificacoes on evento_verificacao;
drop policy if exists equipe_acessa_alertas on alerta_cobranca;
drop policy if exists usuario_ve_proprio_perfil on usuario_interno;

-- `cascade` também remove as 2 constraints de FK que apontavam pra cá
-- (evento_verificacao.verificado_por, alerta_cobranca.atribuido_a) — as
-- COLUNAS em si continuam existindo (mesmo tipo uuid), só ficam sem FK
-- até serem repontadas pra equipe_nexaigen logo abaixo. Confirmado antes
-- de remover: nenhuma rota da aplicação nunca leu/escreveu
-- `usuario_interno` (só existia aqui, no schema) — não é dado real de
-- ninguém sendo perdido.
drop table if exists usuario_interno cascade;

-- Repontando as 2 FKs pra equipe_nexaigen — agora que existe uma
-- identidade real por trás de "quem verificou"/"quem está cuidando deste
-- alerta". `add constraint` não tem `if not exists` no Postgres, daí o
-- guard manual (torna este arquivo seguro de rodar de novo contra um
-- banco que já foi atualizado).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'evento_verificacao_verificado_por_fkey') then
    alter table evento_verificacao
      add constraint evento_verificacao_verificado_por_fkey foreign key (verificado_por) references equipe_nexaigen (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alerta_cobranca_atribuido_a_fkey') then
    alter table alerta_cobranca
      add constraint alerta_cobranca_atribuido_a_fkey foreign key (atribuido_a) references equipe_nexaigen (id);
  end if;
end $$;

-- =====================================================================
-- RLS — desde a rodada de correção do achado crítico, o controle de
-- acesso REAL é a sessão da aplicação (lib/auth.ts#exigirSessao em toda
-- rota, verificado num Server Component em toda página — ver cada
-- app/**/route.ts e app/**/layout.tsx), não mais RLS/auth.uid(): este
-- projeto nunca estabelece uma sessão do Supabase Auth (não existe
-- `supabase.auth.signIn*` em lugar nenhum do código, login é 100% via
-- JWT próprio), então `auth.uid()` é SEMPRE null pra qualquer chamada
-- feita pela aplicação. Todas as rotas agora usam supabaseAdmin()
-- (service_role, ignora RLS por definição) em vez de supabaseServer()
-- (chave anon, RLS-gated) — exatamente o mesmo client que
-- /api/cron/verificar-prazos já usava, pelo mesmo motivo (não há sessão
-- de usuário de verdade pra RLS avaliar).
--
-- RLS continua HABILITADA nas 4 tabelas de negócio, agora SEM NENHUMA
-- policy — deliberado, não uma lacuna: isso faz RLS negar por padrão
-- (fail closed) qualquer chamada hipotética que algum dia use a chave
-- anon/authenticated (ex.: um script futuro, um bug que troque
-- supabaseAdmin() por supabaseServer() sem querer) — só service_role
-- (que ignora RLS) consegue ler/escrever essas tabelas, hoje ou no
-- futuro, mesmo sem nenhuma policy escrita aqui.
alter table cliente_prefeitura enable row level security;
alter table nota_fiscal enable row level security;
alter table evento_verificacao enable row level security;
alter table alerta_cobranca enable row level security;

-- Mesma postura de fail-closed pras 2 tabelas novas — só service_role
-- (usado exclusivamente por lib/auth.ts) toca aqui, nunca a chave anon.
alter table equipe_nexaigen enable row level security;
alter table sessao enable row level security;
