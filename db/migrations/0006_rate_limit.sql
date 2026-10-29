-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0006_rate_limit.sql
--
-- Contadores de limite de tentativas (lib/rateLimit.ts) — login,
-- troca de senha e a rota de integração com o nexaigen-educa. Em Postgres
-- (não em memória) porque um contador por processo não vale nada com mais
-- de uma instância/reinício: cada uma teria o seu.
--
-- Janela FIXA: `janela_inicio` é o início da janela de tempo em que a
-- tentativa caiu (ex.: blocos de 15 min). Uma linha por chave+janela;
-- `insert ... on conflict (chave, janela_inicio) do update set contagem =
-- contagem + 1 returning contagem` incrementa e lê na MESMA instrução —
-- sem janela de corrida entre "contar" e "registrar" (o conflito trava a
-- linha; incrementos concorrentes viram 1, 2, 3... sem repetir número).
--
-- `chave` nunca guarda IP nem e-mail em claro — lib/rateLimit.ts grava um
-- sha256 do identificador (ex.: "login:email:<sha256>"), então a tabela
-- não vira um segundo cadastro de e-mails/IPs.
--
-- Limpeza: linhas de janelas já encerradas não servem pra nada — o job
-- diário (app/api/cron/verificar-prazos) chama
-- lib/rateLimit.ts#limparContadoresExpirados(), que apaga tudo com
-- janela_inicio de mais de 1 dia (índice abaixo).
-- =====================================================================

create table if not exists rate_limit_contador (
  chave text not null,
  janela_inicio timestamptz not null,
  contagem int not null check (contagem >= 0),
  primary key (chave, janela_inicio)
);

create index if not exists idx_rate_limit_contador_janela_inicio
  on rate_limit_contador (janela_inicio);
