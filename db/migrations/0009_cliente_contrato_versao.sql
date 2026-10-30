-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0009_cliente_contrato_versao.sql
--
-- Histórico de versões do CONTRATO em PDF da prefeitura cliente — o MESMO
-- padrão do PDF da nota fiscal (0005_nota_fiscal_arquivo_versao.sql).
-- Antes, cliente_prefeitura guardava UM contrato
-- (contrato_arquivo_chave/contrato_arquivo_nome, 0004) e trocar
-- sobrescrevia a referência. Agora cada envio — pela tela de Clientes ou
-- pela integração com o nexaigen-educa — vira uma linha aqui, e NENHUMA
-- linha nem objeto do bucket é apagado por fluxo algum da aplicação.
--
-- cliente_prefeitura.contrato_arquivo_chave/contrato_arquivo_nome
-- CONTINUAM apontando pra versão ATUAL (compatibilidade); o envio grava a
-- versão nova e move o ponteiro na MESMA transação
-- (lib/versionamentoPdf.ts, compartilhado com o PDF da nota).
--
-- tamanho_bytes/sha256 NULLABLE só por causa do backfill (o PDF legado
-- não é relido aqui) — `npm run recalcular-hash-versoes` preenche depois,
-- lendo o objeto do bucket. enviado_por nulo no backfill (autor
-- desconhecido) e quando o contrato chega pela integração com o Educa
-- (quem envia é o outro sistema — o motivo da versão diz isso). FK sem
-- `on delete` (RESTRICT), como em 0005. Idempotente.
-- =====================================================================

create table if not exists cliente_contrato_versao (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references cliente_prefeitura (id) on delete cascade,
  versao int not null check (versao >= 1),
  chave text not null,
  nome text not null,
  tamanho_bytes bigint check (tamanho_bytes is null or tamanho_bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  enviado_por uuid references equipe_nexaigen (id),
  enviado_em timestamptz not null default now(),
  motivo text check (motivo is null or char_length(motivo) <= 300),
  constraint uq_cliente_contrato_versao unique (cliente_id, versao),
  constraint uq_cliente_contrato_versao_chave unique (chave)
);

insert into cliente_contrato_versao (cliente_id, versao, chave, nome, motivo)
select
  c.id,
  1,
  c.contrato_arquivo_chave,
  coalesce(c.contrato_arquivo_nome, 'contrato.pdf'),
  'Versão registrada pela migração 0009 (contrato anexado antes do histórico de versões; data e autor do envio original desconhecidos).'
from cliente_prefeitura c
where c.contrato_arquivo_chave is not null
  and not exists (select 1 from cliente_contrato_versao v where v.cliente_id = c.id);
