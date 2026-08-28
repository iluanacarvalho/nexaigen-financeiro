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
-- 1. USUÁRIO INTERNO (equipe da NEXAIGEN)
-- ---------------------------------------------------------------------
create table if not exists usuario_interno (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  papel text not null check (papel in ('operacao', 'cobranca', 'admin')),
  created_at timestamptz not null default now()
);

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
  verificado_por uuid references usuario_interno (id),
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
  atribuido_a uuid references usuario_interno (id),
  resolvido_em timestamptz,
  observacao text
);
create index if not exists idx_alerta_nota on alerta_cobranca (nota_fiscal_id);
create index if not exists idx_alerta_status on alerta_cobranca (status);

-- Evita duplicar o mesmo tipo de alerta em aberto para a mesma nota
create unique index if not exists uq_alerta_ativo
  on alerta_cobranca (nota_fiscal_id, tipo)
  where status <> 'resolvido';

-- =====================================================================
-- RLS — mono-tenant, mas ainda assim restrito a usuários autenticados
-- da própria equipe (não é um sistema público).
-- =====================================================================
alter table cliente_prefeitura enable row level security;
alter table nota_fiscal enable row level security;
alter table evento_verificacao enable row level security;
alter table alerta_cobranca enable row level security;
alter table usuario_interno enable row level security;

create policy equipe_acessa_clientes on cliente_prefeitura
  for all using (auth.uid() in (select id from usuario_interno));

create policy equipe_acessa_notas on nota_fiscal
  for all using (auth.uid() in (select id from usuario_interno));

create policy equipe_acessa_verificacoes on evento_verificacao
  for all using (auth.uid() in (select id from usuario_interno));

create policy equipe_acessa_alertas on alerta_cobranca
  for all using (auth.uid() in (select id from usuario_interno));

create policy usuario_ve_proprio_perfil on usuario_interno
  for select using (auth.uid() = id);
