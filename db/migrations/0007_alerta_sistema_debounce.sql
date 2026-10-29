-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0007_alerta_sistema_debounce.sql
--
-- Debounce de 30 min por categoria do alerta de falha de sistema
-- (lib/alertaErroSistema.ts) SEM janela de corrida.
--
-- Por que uma tabela nova: até aqui o debounce era um único
-- `insert into log_alerta_sistema ... where not exists (select ... últimos
-- 30 min)`. Uma instrução só, mas NÃO atômica sob concorrência: no
-- isolamento padrão (READ COMMITTED) cada transação concorrente avalia o
-- NOT EXISTS contra o seu próprio snapshot, nenhuma enxerga a linha ainda
-- não commitada da outra, e todas inserem. Medido de verdade no
-- Postgres local, antes desta migration: 20 chamadas simultâneas da mesma
-- categoria gravaram 10, 4 e 9 linhas (e mandariam o mesmo número de
-- e-mails) em três execuções seguidas.
--
-- O que fecha a corrida: UMA linha por categoria, com chave primária.
-- `insert ... on conflict (categoria) do update ... where <janela vencida>`
-- trava a linha da categoria; uma transação concorrente que bate no
-- conflito ESPERA o commit da primeira e então reavalia o WHERE contra a
-- versão já atualizada (janela recém-renovada → não atualiza → não
-- devolve linha → não envia). Continua sendo UMA instrução (ver o CTE em
-- lib/alertaErroSistema.ts, que também grava o histórico em
-- log_alerta_sistema na mesma instrução).
--
-- log_alerta_sistema continua sendo o HISTÓRICO de alertas enviados;
-- esta tabela é só o estado do debounce ("quando foi o último envio desta
-- categoria").
-- =====================================================================

create table if not exists alerta_sistema_debounce (
  categoria text primary key,
  ultimo_envio_em timestamptz not null
);

-- Backfill: categorias que já alertaram continuam respeitando a janela
-- do último envio registrado (sem isto, a primeira falha depois do deploy
-- reenviaria mesmo dentro dos 30 min).
insert into alerta_sistema_debounce (categoria, ultimo_envio_em)
select categoria, max(enviado_em) from log_alerta_sistema group by categoria
on conflict (categoria) do update
  set ultimo_envio_em = greatest(alerta_sistema_debounce.ultimo_envio_em, excluded.ultimo_envio_em);
