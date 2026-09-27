-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0001_initial.sql
-- Schema completo, Postgres direto (via "pg"/DATABASE_URL) — substitui o
-- Supabase (rodada de migração de infraestrutura). Banco NOVO: nunca
-- existiu dado real neste projeto (confirmado antes desta rodada — o
-- único projeto Supabase que chegou a existir nunca teve a URL sequer
-- preenchida em .env.local, ninguém nunca conseguiu logar), então este
-- arquivo cria o schema FINAL diretamente — sem a dança de "criar →
-- dropar usuario_interno → repontar FK" que supabase/schema.sql precisou
-- fazer (aquele arquivo documentava uma migração incremental de um banco
-- que já existia; aqui não há banco anterior a preservar).
--
-- Mesmo formato de db/migrations/0001_initial.sql do projeto irmão
-- nexaigen-educa: arquivo numerado, plain SQL, aplicado por
-- scripts/migrate.ts.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. EQUIPE NEXAIGEN — login próprio (bcrypt + JWT, ver lib/auth.ts).
-- Um tipo de usuário só, sem papel/hierarquia — qualquer pessoa já
-- logada pode cadastrar outra (POST /api/equipe).
-- ---------------------------------------------------------------------
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
  -- Epoch em milissegundos (não um contador incremental) — trocar a
  -- senha grava Date.now() aqui, garantindo um valor estritamente MAIOR
  -- e DIFERENTE de qualquer token já emitido antes, sem precisar de uma
  -- leitura prévia pra incrementar com segurança. Um access token cujo
  -- token_version não bate mais com o valor atual no banco é tratado
  -- como inválido, mesmo ainda dentro dos 15min de vida do JWT — é o que
  -- faz "trocar a senha" invalidar de verdade um token já emitido, não
  -- só sessões futuras. Ver lib/db.ts sobre o type parser do driver "pg"
  -- pra este campo (bigint vem como string por padrão, convertido pra
  -- number).
  token_version bigint not null default 1,
  -- Permite desativar uma conta sem apagar histórico.
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Refresh token de alta entropia, só o HASH sha256 gravado, nunca o
-- token puro — mesmo formato/contrato de lib/repositorios/sessao.ts do
-- nexaigen-educa.
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
-- (Lei 14.133/2021, Art. 141 — pagamento em até 30 dias corridos contados
-- da liquidação/atesto).
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

-- Evita duplicar o mesmo tipo de alerta em aberto para a mesma nota — é
-- este índice que faz `insert ... on conflict (nota_fiscal_id, tipo)
-- where status <> 'resolvido' do nothing` (app/api/cron/verificar-prazos/route.ts)
-- funcionar, e também o que garante a regra de negócio "e-mail ao cliente
-- só na transição de estado" (ver o comentário completo naquela rota).
create unique index if not exists uq_alerta_ativo
  on alerta_cobranca (nota_fiscal_id, tipo)
  where status <> 'resolvido';

-- =====================================================================
-- SEM RLS/policies — de propósito, não uma omissão. RLS/auth.uid() é um
-- conceito específico do Supabase (separação anon key vs. service_role
-- key na borda do PostgREST); um Postgres acessado só via DATABASE_URL da
-- própria aplicação não tem esse conceito — não existe uma chave "menos
-- privilegiada" pra proteger os dados contra, então recriar algo
-- equivalente aqui seria teatro de segurança. O controle de acesso real
-- sempre foi (desde a rodada anterior) `lib/auth.ts#exigirSessao()`,
-- chamado no início de toda rota administrativa.
-- =====================================================================
