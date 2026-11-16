-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0010_planos_por_porte.sql
--
-- Planos por porte de município (rodada 11-A). Decisão de produto: TODO
-- plano dá acesso a TUDO; o plano muda só a PRECIFICAÇÃO. Fonte única dos
-- planos e valores padrão: lib/planos.ts (dispensa, pequeno_porte,
-- medio_porte, grande_porte). Os valores do cliente (valor_mensal,
-- taxa_implantacao) são o COMBINADO — editáveis, podem diferir do padrão.
--
-- (a) CHECK antigo de plano ('essencial'/'completo', inline na 0001 — o
--     Postgres nomeou cliente_prefeitura_plano_check). Não assumimos o
--     nome: o bloco abaixo procura no catálogo todo CHECK de
--     cliente_prefeitura que menciona a coluna plano e não é um dos dois
--     CHECKs desta migration, e remove.
-- (b) Linhas 'essencial'/'completo' viram 'dispensa', MANTENDO
--     valor_mensal. Até aqui só existiam clientes de TESTE (os planos
--     novos começam a ser vendidos depois das certidões); 'dispensa' é o
--     único plano sem taxa de implantação, então nenhuma cobrança nova
--     aparece pra quem foi convertido. O default da coluna (era
--     'essencial') vira 'dispensa' pelo mesmo motivo.
-- (c) taxa_implantacao: valor COMBINADO de implantação e treinamento
--     (null = sem implantação). CHECK: Dispensa nunca tem taxa — a
--     aplicação já recusa (400), o banco garante.
-- (d) nota_fiscal.tipo: 'mensalidade' (todas as notas existentes) ou
--     'implantacao' (cobrança única, criada À MÃO — nunca automática:
--     uma nota criada sozinha já começaria a contar prazo de atesto).
-- (e) No máximo UMA nota de implantação não cancelada por cliente
--     (índice único parcial). Cancelada não conta: dá pra emitir de novo.
--
-- Idempotente: rodar de novo não muda nada nem dá erro.
-- =====================================================================

do $$
declare
  restricao record;
begin
  for restricao in
    select conname
    from pg_constraint
    where conrelid = 'cliente_prefeitura'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~ '\mplano\M'
      and conname not in ('ck_cliente_prefeitura_plano', 'ck_cliente_prefeitura_dispensa_sem_taxa')
  loop
    execute format('alter table cliente_prefeitura drop constraint %I', restricao.conname);
  end loop;
end;
$$;

update cliente_prefeitura set plano = 'dispensa' where plano in ('essencial', 'completo');

alter table cliente_prefeitura alter column plano set default 'dispensa';

alter table cliente_prefeitura
  add column if not exists taxa_implantacao numeric(12, 2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_plano') then
    alter table cliente_prefeitura
      add constraint ck_cliente_prefeitura_plano
      check (plano in ('dispensa', 'pequeno_porte', 'medio_porte', 'grande_porte'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_taxa_implantacao_positiva') then
    alter table cliente_prefeitura
      add constraint ck_cliente_prefeitura_taxa_implantacao_positiva
      check (taxa_implantacao is null or taxa_implantacao > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_dispensa_sem_taxa') then
    alter table cliente_prefeitura
      add constraint ck_cliente_prefeitura_dispensa_sem_taxa
      check (plano <> 'dispensa' or taxa_implantacao is null);
  end if;
end;
$$;

alter table nota_fiscal
  add column if not exists tipo text not null default 'mensalidade';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_nota_fiscal_tipo') then
    alter table nota_fiscal
      add constraint ck_nota_fiscal_tipo check (tipo in ('mensalidade', 'implantacao'));
  end if;
end;
$$;

create unique index if not exists uq_nota_fiscal_implantacao_ativa
  on nota_fiscal (cliente_id)
  where tipo = 'implantacao' and status <> 'cancelada';
