-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0011_cancelamento_contrato.sql
--
-- Cancelamento de contrato com aviso prévio (rodada 12-A). Regras de
-- negócio (Luana) — as funções puras estão em lib/cancelamentoContrato.ts,
-- a escrita transacional em lib/cancelamentoServico.ts:
--   - aviso prévio FIXO de 30 dias corridos, contados da data de
--     RECEBIMENTO do ofício; término = pedido + 30 dias. Durante o aviso o
--     contrato segue normal (status 'em_aviso_previo') e a mensalidade
--     continua devida até o término;
--   - retratação possível até a data de término (volta a 'ativo');
--   - depois do término o contrato vira 'encerrado' — o que NÃO cancela
--     dívida: notas já emitidas continuam sendo cobradas (job diário).
--
-- (a) CHECK de status_contrato ganha 'em_aviso_previo'. O CHECK antigo
--     era inline na 0001 (o Postgres o nomeou
--     cliente_prefeitura_status_contrato_check) — não assumimos o nome:
--     o bloco abaixo procura no catálogo todo CHECK de cliente_prefeitura
--     que menciona a coluna status_contrato e não é um dos CHECKs desta
--     migration, e remove (mesmo padrão da 0010 com o plano).
-- (b) cancelamento_pedido_em (data do ofício), cancelamento_termino_em
--     (pedido + 30) e cancelamento_motivo (até 500 caracteres). Ficam
--     preenchidos em 'em_aviso_previo' e também depois do encerramento
--     (é por eles que a nota final proporcional ainda pode ser emitida);
--     a retratação os limpa.
-- (c) CHECKs de coerência: pedido e término andam juntos; término é
--     SEMPRE pedido + 30; 'em_aviso_previo' exige os dois.
-- (d) cliente_evento_contrato — trilha de auditoria (quem, quando, de
--     onde). origem: 'painel' (equipe), 'educa' (integração) e 'sistema'
--     (o job diário que encerra o contrato no fim do aviso — não é a
--     equipe nem o Educa, e gravar outra origem seria mentir na
--     auditoria). equipe_id: FK sem `on delete` (RESTRICT), mesmo padrão
--     de nota_fiscal_evento.feito_por — autoria não some.
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
      and pg_get_constraintdef(oid) ~ '\mstatus_contrato\M'
      and conname not in ('ck_cliente_prefeitura_status_contrato', 'ck_cliente_prefeitura_aviso_previo')
  loop
    execute format('alter table cliente_prefeitura drop constraint %I', restricao.conname);
  end loop;
end;
$$;

alter table cliente_prefeitura
  add column if not exists cancelamento_pedido_em date,
  add column if not exists cancelamento_termino_em date,
  add column if not exists cancelamento_motivo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_status_contrato') then
    alter table cliente_prefeitura
      add constraint ck_cliente_prefeitura_status_contrato
      check (status_contrato in ('ativo', 'em_aviso_previo', 'suspenso', 'encerrado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_aviso_previo') then
    alter table cliente_prefeitura
      add constraint ck_cliente_prefeitura_aviso_previo
      check (
        (cancelamento_pedido_em is null) = (cancelamento_termino_em is null)
        and (cancelamento_termino_em is null or cancelamento_termino_em = cancelamento_pedido_em + 30)
        and (status_contrato <> 'em_aviso_previo' or cancelamento_pedido_em is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_cancelamento_motivo_tamanho') then
    alter table cliente_prefeitura
      add constraint ck_cliente_prefeitura_cancelamento_motivo_tamanho
      check (cancelamento_motivo is null or char_length(cancelamento_motivo) <= 500);
  end if;
end;
$$;

create table if not exists cliente_evento_contrato (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references cliente_prefeitura (id) on delete cascade,
  tipo text not null check (tipo in ('cancelamento_registrado', 'cancelamento_retratado', 'contrato_encerrado')),
  data_evento date not null,
  detalhe text check (detalhe is null or char_length(detalhe) <= 500),
  equipe_id uuid references equipe_nexaigen (id),
  origem text not null check (origem in ('painel', 'educa', 'sistema')),
  criado_em timestamptz not null default now()
);
create index if not exists idx_cliente_evento_contrato_cliente on cliente_evento_contrato (cliente_id, criado_em);

-- O job diário procura só os contratos em aviso prévio cujo término passou.
create index if not exists idx_cliente_prefeitura_aviso_previo
  on cliente_prefeitura (cancelamento_termino_em)
  where status_contrato = 'em_aviso_previo';
