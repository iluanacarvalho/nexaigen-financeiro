-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0004_integracao_educa.sql
--
-- Integração AUTOMÁTICA com o nexaigen-educa (bancos SEPARADOS — sem SSO,
-- sem banco compartilhado): ao provisionar um município novo lá, o Educa
-- chama POST /api/integracao/clientes aqui (segredo compartilhado
-- INTEGRACAO_SECRET, nunca sessão de equipe) pra criar/atualizar o
-- cliente_prefeitura correspondente.
--
-- observacao: texto livre, opcional.
-- contrato_arquivo_chave/contrato_arquivo_nome: chave do PDF do contrato
-- no bucket (Railway Buckets, prefixo financeiro/contratos-prefeitura/) e
-- nome original do arquivo (só exibição) — ambos nulos sem contrato.
-- municipio_id_externo: ID do município no banco do Educa. SEM foreign
-- key (não existe FK entre dois bancos diferentes) — é só o identificador
-- que torna a rota de integração IDEMPOTENTE (retry do Educa vira UPDATE,
-- nunca cliente duplicado). Índice único PARCIAL (where ... is not null):
-- clientes cadastrados manualmente (null) coexistem sem conflito.
-- O `on conflict (municipio_id_externo) where municipio_id_externo is not
-- null` da rota precisa bater EXATAMENTE com este predicado.
-- =====================================================================

alter table cliente_prefeitura
  add column if not exists observacao text,
  add column if not exists contrato_arquivo_chave text,
  add column if not exists contrato_arquivo_nome text,
  add column if not exists municipio_id_externo uuid;

create unique index if not exists uq_cliente_municipio_id_externo
  on cliente_prefeitura (municipio_id_externo)
  where municipio_id_externo is not null;
