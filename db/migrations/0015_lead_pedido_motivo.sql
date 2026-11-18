-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0015_lead_pedido_motivo.sql
--
-- Pedidos de reatribuição concorrentes (rodada 16-A1): ao APROVAR um pedido,
-- todos os OUTROS pedidos pendentes do mesmo lead são fechados como
-- 'negado' com motivo "lead já reatribuído", na mesma transação
-- (lib/crmServico.ts#decidirPedido). Esta coluna guarda o motivo da
-- decisão (nulo nas decisões manuais do admin). Só existe em pedido
-- decidido.
--
-- Idempotente: rodar de novo não muda nada nem dá erro.
-- =====================================================================

alter table lead_pedido_reatribuicao
  add column if not exists motivo_decisao text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_lead_pedido_motivo_decisao') then
    alter table lead_pedido_reatribuicao
      add constraint ck_lead_pedido_motivo_decisao
      check (motivo_decisao is null or (resolvido_em is not null and char_length(motivo_decisao) <= 200));
  end if;
end;
$$;
