-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0008_nota_fiscal_ciclo_de_vida.sql
--
-- Tela de Notas fiscais (rodada 08): criar nota, registrar atesto e
-- pagamento, cancelar, reabrir pagamento registrado por engano — com
-- histórico de QUEM fez cada ação e QUANDO. A máquina de estados em si é
-- lib/estadoNota.ts (pura, testada); a escrita transacional é
-- lib/notasServico.ts. (Numerada 0008 porque 0007 já era o debounce do
-- alerta de sistema.)
--
-- 1) Número da NF único POR CLIENTE — índice único parcial (`where
--    numero_nf is not null`): nota sem número (ainda não emitida no
--    sistema da prefeitura) não conflita com nada. A rota trata a
--    violação (23505) como 409. Antes de criar o índice, este arquivo
--    PARA com uma mensagem clara se já existirem duplicatas — dado fiscal
--    não é "corrigido" em silêncio por uma migration.
--
-- 2) Cancelamento: motivo (obrigatório na aplicação, até 300 caracteres),
--    quando e por quem.
--
-- 3) nota_fiscal_evento — histórico único de TODAS as ações sobre a nota
--    (criação, verificação no portal, atesto, pagamento, cancelamento,
--    reabertura de pagamento). evento_verificacao (0001) continua sendo
--    gravado pela Fila de Checagem como antes — só não comporta os tipos
--    novos (o CHECK dela só aceita os 4 resultados de checagem no portal).
--    feito_por: FK sem `on delete` (RESTRICT) — autoria não some se a
--    conta for apagada (desativar é equipe_nexaigen.ativo). Nulo só no
--    backfill abaixo (autor da criação desconhecido) e em ações do
--    sistema.
-- =====================================================================

do $$
begin
  if exists (
    select 1 from nota_fiscal where numero_nf is not null group by cliente_id, numero_nf having count(*) > 1
  ) then
    raise exception 'Existem notas com o MESMO numero_nf para o mesmo cliente — resolva as duplicatas manualmente antes desta migration (select cliente_id, numero_nf, count(*) from nota_fiscal where numero_nf is not null group by 1, 2 having count(*) > 1).';
  end if;
end;
$$;

create unique index if not exists uq_nota_fiscal_cliente_numero_nf
  on nota_fiscal (cliente_id, numero_nf)
  where numero_nf is not null;

alter table nota_fiscal
  add column if not exists motivo_cancelamento text,
  add column if not exists cancelado_em timestamptz,
  add column if not exists cancelado_por uuid references equipe_nexaigen (id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_nota_fiscal_motivo_cancelamento_tamanho') then
    alter table nota_fiscal
      add constraint ck_nota_fiscal_motivo_cancelamento_tamanho
      check (motivo_cancelamento is null or char_length(motivo_cancelamento) <= 300);
  end if;
end;
$$;

create table if not exists nota_fiscal_evento (
  id uuid primary key default gen_random_uuid(),
  nota_fiscal_id uuid not null references nota_fiscal (id) on delete cascade,
  tipo text not null check (
    tipo in ('criacao', 'verificacao_portal', 'atesto', 'pagamento', 'cancelamento', 'reabertura_pagamento')
  ),
  status_anterior text,
  status_novo text,
  data_evento date,                 -- data do fato (atesto/pagamento/pagamento desfeito), quando houver
  motivo text check (motivo is null or char_length(motivo) <= 300),
  observacao text,
  feito_por uuid references equipe_nexaigen (id),
  feito_em timestamptz not null default now()
);
create index if not exists idx_nota_fiscal_evento_nota on nota_fiscal_evento (nota_fiscal_id, feito_em);

-- Backfill: toda nota que já existia ganha o evento de criação (autor
-- desconhecido, momento = created_at), pra histórico nunca começar vazio.
insert into nota_fiscal_evento (nota_fiscal_id, tipo, status_novo, feito_em, observacao)
select nf.id, 'criacao', nf.status, nf.created_at, 'Evento registrado pela migração 0008 (nota criada antes do histórico de eventos).'
from nota_fiscal nf
where not exists (select 1 from nota_fiscal_evento e where e.nota_fiscal_id = nf.id and e.tipo = 'criacao');
