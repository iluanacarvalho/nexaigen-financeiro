-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0003_log_alerta_sistema.sql
--
-- Este projeto só tinha alerta de NEGÓCIO (alerta_cobranca — atraso de
-- pagamento) e os dois canais de e-mail que decorrem dele
-- (lib/notificacao-interna.ts, lib/notificacaoCliente.ts). Nenhum
-- mecanismo cobria falha TÉCNICA de sistema (bucket fora do ar, Resend
-- indisponível, configuração ausente, exceção não tratada chegando ao
-- servidor) — essas falhas só produziam um console.warn/console.error,
-- visível apenas em quem estiver olhando o log do servidor naquele
-- momento. `log_alerta_sistema` é a tabela que sustenta
-- lib/alertaErroSistema.ts: registra cada tentativa de alerta por
-- categoria e serve de base pro debounce de 30 minutos (evita inundar a
-- caixa de entrada quando uma falha persiste por um bom tempo — ex.:
-- bucket fora do ar por horas gerando uma falha por requisição).
--
-- `categoria` é texto livre (sem enum fechado) — as categorias nascem do
-- ponto de chamada (lib/armazenamentoObjetos.ts, lib/notificacao-interna.ts,
-- lib/notificacaoCliente.ts, o job de cron, instrumentation.ts), não de
-- uma lista fixa definida aqui; mesmo raciocínio já aplicado a outras
-- colunas de texto livre deste schema (cmei.tipo/situacao no projeto
-- irmão nexaigen-educa) quando nenhuma fonte define um vocabulário
-- controlado.
--
-- `enviado_em` nasce com o INSERT (default now()) — o debounce é decidido
-- num único INSERT ... WHERE NOT EXISTS atômico (ver
-- lib/alertaErroSistema.ts), nunca um SELECT seguido de um INSERT
-- separado, que teria uma janela de corrida entre os dois.
-- =====================================================================

create table if not exists log_alerta_sistema (
  id uuid primary key default gen_random_uuid(),
  categoria text not null,
  mensagem text not null,
  enviado_em timestamptz not null default now()
);

-- Toda consulta de debounce filtra por categoria + janela de tempo
-- recente — índice composto, categoria primeiro (sempre no WHERE),
-- enviado_em em ordem decrescente (a consulta só se importa com a
-- tentativa MAIS RECENTE daquela categoria).
create index if not exists idx_log_alerta_sistema_categoria_enviado_em
  on log_alerta_sistema (categoria, enviado_em desc);
