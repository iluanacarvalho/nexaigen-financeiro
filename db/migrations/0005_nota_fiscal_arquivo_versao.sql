-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0005_nota_fiscal_arquivo_versao.sql
--
-- Histórico de versões do PDF da nota fiscal. Antes desta migration,
-- nota_fiscal guardava UM pdf (arquivo_pdf_chave/arquivo_pdf_nome,
-- 0002_nota_fiscal_arquivo_pdf.sql) e substituir sobrescrevia a
-- referência — a versão anterior se perdia. Documento fiscal precisa de
-- histórico: cada envio vira uma linha aqui, e NENHUMA linha (nem o
-- objeto correspondente no bucket) é apagada por fluxo algum da aplicação.
--
-- nota_fiscal.arquivo_pdf_chave/arquivo_pdf_nome CONTINUAM existindo e
-- apontam sempre para a versão ATUAL (compatibilidade com quem já lê
-- esses campos — GET /api/notas, a fila de checagem). A rota de upload
-- (app/api/notas/[id]/arquivo) grava a versão nova e atualiza esse
-- ponteiro na MESMA transação.
--
-- chave: objeto no bucket, ÚNICA por versão (unique abaixo) — a rota gera
-- uma chave nova com uuid a cada envio, então nenhum envio sobrescreve o
-- objeto de outro.
-- tamanho_bytes/sha256: NULLABLE só por causa do backfill abaixo — o PDF
-- legado já está no bucket e não é relido nesta migration (SQL não lê o
-- bucket), então não há como calcular. Todo envio a partir de 0005 grava
-- os dois (a rota calcula a partir dos bytes recebidos).
-- enviado_por: FK sem `on delete` (padrão RESTRICT) de propósito — uma
-- conta da equipe com versões enviadas não pode ser apagada e levar o
-- registro de autoria junto; desativar conta é `equipe_nexaigen.ativo`.
-- Nulo só no backfill (não se sabe quem enviou o PDF legado).
--
-- Idempotente (if not exists / where not exists): rodar de novo não
-- duplica nada.
-- =====================================================================

create table if not exists nota_fiscal_arquivo_versao (
  id uuid primary key default gen_random_uuid(),
  nota_fiscal_id uuid not null references nota_fiscal (id) on delete cascade,
  versao int not null check (versao >= 1),
  chave text not null,
  nome text not null,
  tamanho_bytes bigint check (tamanho_bytes is null or tamanho_bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  enviado_por uuid references equipe_nexaigen (id),
  enviado_em timestamptz not null default now(),
  motivo text check (motivo is null or char_length(motivo) <= 300),
  constraint uq_nota_fiscal_arquivo_versao unique (nota_fiscal_id, versao),
  constraint uq_nota_fiscal_arquivo_versao_chave unique (chave)
);

-- Backfill: nota que já tinha PDF antes do histórico vira a versão 1, com
-- os dados que existem. enviado_em = momento da migration (a data real do
-- envio legado não foi registrada em lugar nenhum) e motivo identifica a
-- origem, pra ninguém ler essa data como a do envio de verdade.
insert into nota_fiscal_arquivo_versao (nota_fiscal_id, versao, chave, nome, motivo)
select
  nf.id,
  1,
  nf.arquivo_pdf_chave,
  coalesce(nf.arquivo_pdf_nome, 'nota-fiscal.pdf'),
  'Versão registrada pela migração 0005 (PDF anexado antes do histórico de versões; data e autor do envio original desconhecidos).'
from nota_fiscal nf
where nf.arquivo_pdf_chave is not null
  and not exists (select 1 from nota_fiscal_arquivo_versao v where v.nota_fiscal_id = nf.id);
