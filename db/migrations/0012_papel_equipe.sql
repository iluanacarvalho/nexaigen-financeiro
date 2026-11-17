-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0012_papel_equipe.sql
--
-- Perfis de acesso da equipe (rodada 15-A). O Financeiro vai virar o
-- sistema interno da NEXAIGEN (CRM, comissões, RH) — antes de qualquer
-- módulo novo, cada pessoa passa a ter um PAPEL: 'admin', 'financeiro',
-- 'vendas' ou 'rh'. A matriz papel × área (o que cada um vê) mora no
-- código, em lib/papeis.ts — aqui só a coluna e o CHECK.
--
-- Default 'admin': quem já existia tinha acesso a tudo (não havia papel),
-- então continua com acesso a tudo — nenhuma pessoa perde acesso por
-- causa desta migration. O primeiro login criado pelo bootstrap
-- (scripts/bootstrap-equipe-nexaigen.ts) também nasce admin. Contas novas
-- criadas pela tela Equipe (POST /api/equipe) sempre informam o papel.
--
-- Idempotente: rodar de novo não muda nada nem dá erro.
-- =====================================================================

alter table equipe_nexaigen
  add column if not exists papel text not null default 'admin';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_equipe_nexaigen_papel') then
    alter table equipe_nexaigen
      add constraint ck_equipe_nexaigen_papel check (papel in ('admin', 'financeiro', 'vendas', 'rh'));
  end if;
end;
$$;
