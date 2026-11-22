-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0017_fechamento.sql
--
-- FECHAMENTO (rodada 16-B1): aceite da prefeitura no CRM → cliente →
-- contrato gerado a partir de modelo → tarefas de Contratos e Implantação.
-- Regras puras: lib/fechamento.ts, lib/contratoModelo.ts; escrita:
-- lib/fechamentoServico.ts, lib/tarefasServico.ts, lib/modelosContratoServico.ts.
--
-- REGRA DE NEGÓCIO CENTRAL: vigência e cobrança começam na DATA DE
-- ASSINATURA do contrato. No ACEITE o cliente nasce em
-- 'aguardando_assinatura' — SEM data de início, fora de MRR, notas e
-- alertas. Só a assinatura registrada (data + PDF) o torna 'ativo', com
-- data_inicio_contrato = data da assinatura.
--
-- (a) cliente_prefeitura:
--     - status_contrato ganha 'aguardando_assinatura' (CHECK nomeado
--       trocado — mesmo padrão da 0011);
--     - data_inicio_contrato passa a aceitar NULL, e SÓ em
--       'aguardando_assinatura' (CHECK amarra os dois lados);
--     - cnpj (já existia, texto livre): passa a ser SÓ os 14 dígitos (CHECK).
--       O valor antigo é normalizado (pontuação removida); o que não virar
--       14 dígitos vai INTEIRO pra cnpj_legado (nada é apagado) e cnpj fica nulo;
--     - endereço (logradouro, número, complemento, bairro, CEP de 8 dígitos),
--       representante legal (nome, cargo), cargo do contato, lead de origem
--       (lead_id, um cliente por lead), fechado_em/fechado_por.
--       NÃO há CPF (LGPD: não é necessário — README).
-- (b) contrato_modelo — modelos de contrato por plano, VERSÕES IMUTÁVEIS
--     (trigger: conteúdo/título/plano/versão nunca mudam; nada é apagado; a
--     única mudança permitida é rascunho → aprovado, com quem e quando).
--     Seed: 1 RASCUNHO PROVISÓRIO por plano (v1), texto curto marcado como
--     provisório, com as cláusulas JÁ COMBINADAS e "[A SER REVISADO PELO
--     JURÍDICO]" nos trechos jurídicos — o texto real o admin coloca pela tela.
-- (c) tarefa_operacional — tarefas de Contratos (assinatura) e Implantação.
--     No máximo UMA aberta/em andamento por (cliente, tipo).
-- (d) tarefa_historico — SOMENTE ACRÉSCIMO (trigger bloqueia UPDATE,
--     DELETE e TRUNCATE). autor_id nulo = a integração com o Educa.
-- (e) cliente_evento_contrato: + 'aceite_registrado', 'assinatura_registrada',
--     'contrato_gerado' (+ modelo_contrato_id). Os leitores de cancelamento e
--     do relatório filtram só os tipos de contrato conhecidos
--     (lib/cancelamentoServico.ts#TIPOS_EVENTO_CONTRATO) — os novos não os afetam.
-- (f) equipe_nexaigen.papel: + 'contratos' e 'implantacao'.
--
-- Idempotente: rodar de novo não muda nada nem dá erro.
-- =====================================================================

-- (a) cliente_prefeitura -----------------------------------------------------

alter table cliente_prefeitura drop constraint if exists ck_cliente_prefeitura_status_contrato;
alter table cliente_prefeitura add constraint ck_cliente_prefeitura_status_contrato
  check (status_contrato in ('aguardando_assinatura', 'ativo', 'em_aviso_previo', 'suspenso', 'encerrado'));

alter table cliente_prefeitura alter column data_inicio_contrato drop not null;
alter table cliente_prefeitura drop constraint if exists ck_cliente_prefeitura_inicio_so_depois_da_assinatura;
alter table cliente_prefeitura add constraint ck_cliente_prefeitura_inicio_so_depois_da_assinatura
  check ((status_contrato = 'aguardando_assinatura') = (data_inicio_contrato is null));

alter table cliente_prefeitura
  add column if not exists cnpj_legado text,
  add column if not exists endereco_logradouro text,
  add column if not exists endereco_numero text,
  add column if not exists endereco_complemento text,
  add column if not exists endereco_bairro text,
  add column if not exists endereco_cep text,
  add column if not exists representante_nome text,
  add column if not exists representante_cargo text,
  add column if not exists contato_cargo text,
  add column if not exists lead_id uuid references lead (id),
  add column if not exists fechado_em timestamptz,
  add column if not exists fechado_por uuid references equipe_nexaigen (id);

-- CNPJ: normaliza o que já existe ANTES do CHECK (nunca apaga — o que não serve vai pro legado).
update cliente_prefeitura set cnpj_legado = cnpj, cnpj = null
  where cnpj is not null and regexp_replace(cnpj, '\D', '', 'g') !~ '^[0-9]{14}$';
update cliente_prefeitura set cnpj = regexp_replace(cnpj, '\D', '', 'g')
  where cnpj is not null and cnpj !~ '^[0-9]{14}$';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_cnpj') then
    alter table cliente_prefeitura add constraint ck_cliente_prefeitura_cnpj check (cnpj is null or cnpj ~ '^[0-9]{14}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_cep') then
    alter table cliente_prefeitura add constraint ck_cliente_prefeitura_cep check (endereco_cep is null or endereco_cep ~ '^[0-9]{8}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_cliente_prefeitura_dados_fechamento_tamanho') then
    alter table cliente_prefeitura add constraint ck_cliente_prefeitura_dados_fechamento_tamanho check (
      coalesce(char_length(endereco_logradouro), 0) <= 200 and coalesce(char_length(endereco_numero), 0) <= 20
      and coalesce(char_length(endereco_complemento), 0) <= 100 and coalesce(char_length(endereco_bairro), 0) <= 120
      and coalesce(char_length(representante_nome), 0) <= 200 and coalesce(char_length(representante_cargo), 0) <= 120
      and coalesce(char_length(contato_cargo), 0) <= 120
    );
  end if;
end;
$$;

create unique index if not exists uq_cliente_prefeitura_lead on cliente_prefeitura (lead_id) where lead_id is not null;

-- (b) contrato_modelo ---------------------------------------------------------

create table if not exists contrato_modelo (
  id uuid primary key default gen_random_uuid(),
  plano text not null check (plano in ('dispensa', 'pequeno_porte', 'medio_porte', 'grande_porte')),
  versao integer not null check (versao >= 1),
  titulo text not null check (char_length(btrim(titulo)) between 3 and 200),
  conteudo text not null check (char_length(conteudo) between 1 and 100000),
  status text not null default 'rascunho' check (status in ('rascunho', 'aprovado')),
  criado_em timestamptz not null default now(),
  criado_por uuid references equipe_nexaigen (id),
  aprovado_em timestamptz,
  aprovado_por uuid references equipe_nexaigen (id),
  constraint uq_contrato_modelo_plano_versao unique (plano, versao),
  constraint ck_contrato_modelo_aprovacao check (
    (status = 'aprovado' and aprovado_em is not null and aprovado_por is not null)
    or (status = 'rascunho' and aprovado_em is null and aprovado_por is null)
  )
);

create or replace function trg_contrato_modelo_imutavel() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'contrato_modelo: versões são imutáveis — nada é apagado (crie uma versão nova).' using errcode = 'P0001';
  end if;
  if new.plano is distinct from old.plano or new.versao is distinct from old.versao or new.titulo is distinct from old.titulo
     or new.conteudo is distinct from old.conteudo or new.criado_em is distinct from old.criado_em or new.criado_por is distinct from old.criado_por then
    raise exception 'contrato_modelo: versões são imutáveis — para mudar o texto, crie uma versão nova.' using errcode = 'P0001';
  end if;
  if old.status = 'aprovado' then
    raise exception 'contrato_modelo: versão aprovada não muda mais.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists contrato_modelo_imutavel on contrato_modelo;
create trigger contrato_modelo_imutavel before update or delete on contrato_modelo
  for each row execute function trg_contrato_modelo_imutavel();
drop trigger if exists contrato_modelo_sem_truncate on contrato_modelo;
create trigger contrato_modelo_sem_truncate before truncate on contrato_modelo
  for each statement execute function trg_contrato_modelo_imutavel();

-- Seed: rascunho PROVISÓRIO v1 por plano. Só as cláusulas já combinadas; o resto é do jurídico.
insert into contrato_modelo (plano, versao, titulo, conteudo)
select p.plano, 1, 'Contrato de prestação de serviços — ' || p.rotulo || ' (MODELO PROVISÓRIO)',
$modelo$# CONTRATO DE PRESTAÇÃO DE SERVIÇOS — MODELO PROVISÓRIO

**ATENÇÃO: texto provisório gerado pela plataforma para conferência dos dados. Não substitui o contrato revisado pelo jurídico. [A SER REVISADO PELO JURÍDICO]**

## 1. Partes

CONTRATANTE: Município de {{municipio_nome}} — {{uf}} (código IBGE {{codigo_ibge}}), inscrito no CNPJ sob o nº {{cnpj}}, com sede em {{endereco_completo}}, neste ato representado por {{representante_nome}}, {{representante_cargo}}.

CONTRATADA: NEXAIGEN. [A SER REVISADO PELO JURÍDICO — qualificação completa da contratada]

## 2. Objeto e plano

Prestação de serviços da plataforma NEXAIGEN no plano {{plano_rotulo}}. [A SER REVISADO PELO JURÍDICO — descrição detalhada do objeto]

## 3. Vigência e mensalidade

A vigência começa na data da assinatura deste contrato e a cobrança é feita em períodos de 30 (trinta) dias contados a partir dessa data. A mensalidade é de {{valor_mensal}} ({{valor_mensal_extenso}}).

Taxa de implantação e treinamento: {{taxa_implantacao}} ({{taxa_implantacao_extenso}}), cobrada uma única vez.

## 4. Cancelamento

Qualquer das partes pode cancelar o contrato mediante aviso prévio de 30 (trinta) dias. A última nota é proporcional aos dias do último período. Cobranças já emitidas continuam devidas após o encerramento. [A SER REVISADO PELO JURÍDICO]

## 5. Divulgação

A divulgação do nome do Município como cliente da NEXAIGEN é opcional e depende de autorização por escrito do CONTRATANTE.

## 6. Dados pessoais (LGPD)

O tratamento de dados pessoais segue o anexo de proteção de dados deste contrato. [A SER REVISADO PELO JURÍDICO — anexo LGPD]

## 7. Contato operacional

{{contato_nome}} — {{contato_cargo}} — {{contato_email}} — {{contato_telefone}}

## Assinaturas

{{municipio_nome}} — {{uf}}, {{data_assinatura}}.

_____________________________________
{{representante_nome}} — {{representante_cargo}}

_____________________________________
NEXAIGEN

Documento gerado em {{data_geracao}}.$modelo$
from (values ('dispensa', 'Dispensa'), ('pequeno_porte', 'Pequeno Porte'), ('medio_porte', 'Médio Porte'), ('grande_porte', 'Grande Porte')) as p(plano, rotulo)
on conflict (plano, versao) do nothing;

-- (c) tarefa_operacional --------------------------------------------------------

create table if not exists tarefa_operacional (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('contrato_assinatura', 'implantacao')),
  cliente_id uuid not null references cliente_prefeitura (id),
  papel_responsavel text not null check (papel_responsavel in ('contratos', 'implantacao')),
  responsavel_id uuid references equipe_nexaigen (id),
  status text not null default 'aberta' check (status in ('aberta', 'em_andamento', 'concluida', 'cancelada')),
  prazo date not null,
  criado_em timestamptz not null default now(),
  assumida_em timestamptz,
  concluida_em timestamptz,
  concluida_por uuid references equipe_nexaigen (id),
  observacao text check (char_length(observacao) <= 1000),
  constraint ck_tarefa_papel_do_tipo check ((tipo = 'contrato_assinatura') = (papel_responsavel = 'contratos')),
  constraint ck_tarefa_em_andamento_tem_responsavel check (status <> 'em_andamento' or responsavel_id is not null),
  constraint ck_tarefa_concluida_tem_data check ((status = 'concluida') = (concluida_em is not null))
);
create unique index if not exists uq_tarefa_aberta_por_cliente_tipo on tarefa_operacional (cliente_id, tipo) where status in ('aberta', 'em_andamento');
create index if not exists idx_tarefa_fila on tarefa_operacional (papel_responsavel, status, prazo);
create index if not exists idx_tarefa_responsavel on tarefa_operacional (responsavel_id) where status in ('aberta', 'em_andamento');

-- (d) tarefa_historico — somente acréscimo ---------------------------------------

create table if not exists tarefa_historico (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references tarefa_operacional (id),
  acao text not null check (acao in ('criada', 'assumida', 'devolvida', 'concluida', 'cancelada', 'prazo_alterado')),
  autor_id uuid references equipe_nexaigen (id),
  em timestamptz not null default clock_timestamp(),
  detalhe text check (char_length(detalhe) <= 1000)
);
create index if not exists idx_tarefa_historico_tarefa on tarefa_historico (tarefa_id, em);

create or replace function trg_tarefa_historico_imutavel() returns trigger
language plpgsql
as $$
begin
  raise exception 'tarefa_historico é somente acréscimo: % não é permitido.', tg_op using errcode = 'P0001';
end;
$$;

drop trigger if exists tarefa_historico_imutavel on tarefa_historico;
create trigger tarefa_historico_imutavel before update or delete on tarefa_historico
  for each row execute function trg_tarefa_historico_imutavel();
drop trigger if exists tarefa_historico_sem_truncate on tarefa_historico;
create trigger tarefa_historico_sem_truncate before truncate on tarefa_historico
  for each statement execute function trg_tarefa_historico_imutavel();

-- (e) cliente_evento_contrato --------------------------------------------------------

alter table cliente_evento_contrato add column if not exists modelo_contrato_id uuid references contrato_modelo (id);
alter table cliente_evento_contrato drop constraint if exists ck_cliente_evento_contrato_tipo;
alter table cliente_evento_contrato add constraint ck_cliente_evento_contrato_tipo check (
  tipo in ('cancelamento_registrado', 'cancelamento_retratado', 'contrato_encerrado', 'divulgacao_autorizada', 'divulgacao_revogada',
           'aceite_registrado', 'assinatura_registrada', 'contrato_gerado')
);

-- (f) papéis novos ---------------------------------------------------------------------

alter table equipe_nexaigen drop constraint if exists ck_equipe_nexaigen_papel;
alter table equipe_nexaigen add constraint ck_equipe_nexaigen_papel
  check (papel in ('admin', 'financeiro', 'vendas', 'rh', 'contratos', 'implantacao'));
