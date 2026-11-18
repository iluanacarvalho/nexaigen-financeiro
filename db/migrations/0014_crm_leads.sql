-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0014_crm_leads.sql
--
-- CRM de leads (rodada 16-A): prefeituras que ainda NÃO são clientes, da
-- primeira conversa até o fechamento. Regras puras: lib/crm.ts; escrita:
-- lib/crmServico.ts; leitura (com o filtro por vendedor NO SQL):
-- lib/crmRepositorio.ts. Esta rodada NÃO fecha negócio: a etapa 'ganho'
-- existe no CHECK, mas nenhuma rota deixa marcá-la (o fechamento é o fluxo
-- da rodada 16-B).
--
-- lead
--   - municipio_nome + uf (27 siglas) + codigo_ibge opcional (7 dígitos);
--   - nome_busca: nome normalizado (sem acento/caixa/"Prefeitura de" —
--     lib/ibge.ts#nomeDeMunicipioNormalizado), gravado pela aplicação; é a
--     chave de duplicidade e de busca ("jaguapita" acha "Jaguapitã");
--   - DUPLICIDADE garantida no banco: no máximo UM lead ABERTO (etapa fora
--     de ganho/perdido) por codigo_ibge, e por uf + nome_busca;
--   - plano_interesse = um dos ids de lib/planos.ts; valor estimado em
--     CENTAVOS inteiros (integer, como o resto do sistema em centavos);
--   - motivo_perda obrigatório em 'perdido' e nulo nas demais etapas
--     (detalhe_perda idem); descrição da próxima ação só com data;
--   - versao: controle otimista de concorrência (PATCH manda a versão que
--     leu; divergiu → 409 "alguém alterou este lead, recarregue").
--
-- lead_interacao — HISTÓRICO, SOMENTE ACRÉSCIMO: trigger bloqueia UPDATE,
--   DELETE e TRUNCATE (trilha de auditoria). `em` = clock_timestamp():
--   várias linhas na mesma transação ficam em ordem.
--
-- lead_pedido_reatribuicao — "Pedir este lead" (vendedor pede um lead de
--   colega parado há mais de 60 dias): NÃO muda o dono; o admin aprova
--   (vira troca de vendedor, com histórico) ou nega. No máximo um pedido
--   PENDENTE por lead + solicitante (índice único parcial).
--
-- Idempotente: rodar de novo não muda nada nem dá erro.
-- =====================================================================

create table if not exists lead (
  id uuid primary key default gen_random_uuid(),
  municipio_nome text not null check (char_length(btrim(municipio_nome)) between 2 and 200),
  nome_busca text not null check (char_length(nome_busca) between 1 and 200),
  uf char(2) not null check (uf in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  codigo_ibge text check (codigo_ibge ~ '^[0-9]{7}$'),
  populacao integer check (populacao >= 0),
  plano_interesse text check (plano_interesse in ('dispensa', 'pequeno_porte', 'medio_porte', 'grande_porte')),
  valor_mensal_estimado_centavos integer check (valor_mensal_estimado_centavos >= 0),
  contato_nome text check (char_length(contato_nome) <= 200),
  contato_cargo text check (char_length(contato_cargo) <= 120),
  contato_email text check (char_length(contato_email) <= 254 and contato_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  contato_telefone text check (char_length(contato_telefone) <= 40),
  origem text not null check (origem in ('indicacao', 'evento', 'site', 'contato_direto', 'outro')),
  etapa text not null default 'novo' check (etapa in ('novo', 'contato', 'demonstracao', 'proposta', 'negociacao', 'ganho', 'perdido')),
  vendedor_id uuid not null references equipe_nexaigen (id),
  motivo_perda text check (motivo_perda in ('preco', 'sem_orcamento', 'concorrente', 'sem_interesse', 'sem_resposta', 'outro')),
  detalhe_perda text check (char_length(detalhe_perda) <= 1000),
  proxima_acao_em date,
  proxima_acao_descricao text check (char_length(proxima_acao_descricao) <= 300),
  versao integer not null default 1 check (versao >= 1),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por uuid references equipe_nexaigen (id),
  constraint ck_lead_motivo_perda check ((etapa = 'perdido') = (motivo_perda is not null)),
  constraint ck_lead_detalhe_perda check (detalhe_perda is null or etapa = 'perdido'),
  constraint ck_lead_proxima_acao check (proxima_acao_descricao is null or proxima_acao_em is not null)
);

create index if not exists idx_lead_vendedor_etapa on lead (vendedor_id, etapa);
create index if not exists idx_lead_etapa on lead (etapa);
create index if not exists idx_lead_proxima_acao on lead (proxima_acao_em) where etapa not in ('ganho', 'perdido');
create unique index if not exists uq_lead_codigo_ibge_aberto on lead (codigo_ibge) where codigo_ibge is not null and etapa not in ('ganho', 'perdido');
create unique index if not exists uq_lead_nome_uf_aberto on lead (uf, nome_busca) where etapa not in ('ganho', 'perdido');
create index if not exists idx_lead_nome_busca on lead (nome_busca);

create table if not exists lead_interacao (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references lead (id),
  tipo text not null check (tipo in ('nota', 'ligacao', 'email', 'reuniao', 'whatsapp', 'visita', 'mudanca_etapa', 'troca_vendedor', 'edicao', 'reabertura')),
  texto text check (char_length(texto) <= 2000),
  etapa_anterior text check (etapa_anterior in ('novo', 'contato', 'demonstracao', 'proposta', 'negociacao', 'ganho', 'perdido')),
  etapa_nova text check (etapa_nova in ('novo', 'contato', 'demonstracao', 'proposta', 'negociacao', 'ganho', 'perdido')),
  autor_id uuid not null references equipe_nexaigen (id),
  em timestamptz not null default clock_timestamp()
);
create index if not exists idx_lead_interacao_lead on lead_interacao (lead_id, em);

create or replace function trg_lead_interacao_imutavel() returns trigger
language plpgsql
as $$
begin
  raise exception 'lead_interacao é somente acréscimo (histórico do CRM): % não é permitido.', tg_op
    using errcode = 'P0001';
end;
$$;

drop trigger if exists lead_interacao_imutavel on lead_interacao;
create trigger lead_interacao_imutavel
  before update or delete on lead_interacao
  for each row execute function trg_lead_interacao_imutavel();

drop trigger if exists lead_interacao_sem_truncate on lead_interacao;
create trigger lead_interacao_sem_truncate
  before truncate on lead_interacao
  for each statement execute function trg_lead_interacao_imutavel();

create table if not exists lead_pedido_reatribuicao (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references lead (id),
  solicitante_id uuid not null references equipe_nexaigen (id),
  em timestamptz not null default now(),
  resolvido_em timestamptz,
  resolvido_por uuid references equipe_nexaigen (id),
  decisao text check (decisao in ('aprovado', 'negado')),
  constraint ck_lead_pedido_resolucao check (
    (resolvido_em is null and resolvido_por is null and decisao is null)
    or (resolvido_em is not null and resolvido_por is not null and decisao is not null)
  )
);
create unique index if not exists uq_lead_pedido_pendente on lead_pedido_reatribuicao (lead_id, solicitante_id) where resolvido_em is null;
create index if not exists idx_lead_pedido_pendentes on lead_pedido_reatribuicao (em) where resolvido_em is null;
