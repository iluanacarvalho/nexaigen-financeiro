# NEXAIGEN Financeiro

Sistema interno da NEXAIGEN (não é vendido a prefeituras) para controlar contratos, emissão de
notas fiscais, checagem de atesto e escalonamento automático de cobrança. Pensado para operar em
escala — o objetivo é sustentar centenas/milhares de contratos com uma equipe pequena de checagem
manual e tudo o mais automatizado.

**Verificado nesta sessão (rodada mais recente: upload de PDF da nota fiscal — Seção 9):**
`tsc --noEmit` (zero erros), `next build` (agora 17 rotas, incluindo `POST`/`GET
/api/notas/[id]/arquivo`), `npm run test` (**98 testes unitários**, banco e armazenamento de
objetos mockados), `npm run test:integration` (**7 testes** contra Postgres real, incluindo a
persistência das colunas novas `arquivo_pdf_chave`/`arquivo_pdf_nome`), e checagem manual contra
servidor real + Postgres local (upload/download reais via `curl`, incluindo o caso sem
`RAILWAY_BUCKET_*` configurado — 502 gracioso, nunca uma exceção). Rodada anterior (migração de
infraestrutura Supabase → Postgres direto): `npm install`, `next build` (17 páginas/rotas),
`npm run test` (73 testes), `npm run test:integration` (6 testes) e um passo a passo manual
completo (login → trocar senha → criar cliente → criar nota → atestar → rodar cron → ver o alerta
em `/api/alertas`) — ver Seção 8.

**ACHADO CRÍTICO DE SEGURANÇA, CORRIGIDO — leia antes de usar com dado real.** Até a rodada de
login próprio (ver Seção 7), esta plataforma não tinha autenticação nenhuma: toda rota de API e
toda página estavam completamente abertas a qualquer pessoa com a URL, sem senha nenhuma. Isso
está corrigido — mas se você está lendo isto num checkout antigo ou branch antiga, NÃO use com
dado de cliente real sem confirmar que `lib/auth.ts`/`equipe_nexaigen` já existem.

---

## 1. Como o fluxo funciona

```
Emissão da NF (mensal, por cliente)
   -> status "aguardando_atesto"
   -> aparece na Fila de Checagem (/checagem)
   -> alguém confere o portal da prefeitura e registra o resultado
        -> "atestada" -> grava data_atesto -> trigger calcula data_limite_pagamento (+30 dias)
   -> job diário (cron) recalcula o status de todas as notas em aberto:
        - sem atesto há mais de 20 dias -> alerta "sem_atesto_prolongado"
        - a 5 dias do vencimento -> alerta "proximo_vencimento"
        - passou do vencimento -> status "vencida"
        - 60+ dias de atraso -> alerta "atraso_60_dias" -> notifica o time de cobrança (e-mail via Resend)
   -> em TODOS os 4 estágios acima, e-mail automático também pro contato da prefeitura
      cliente (lib/notificacaoCliente.ts) — só na TRANSIÇÃO de estado, nunca repetido todo
      dia enquanto o estado persistir; sempre com BCC pro time interno de cobrança
```

Os limiares (20 dias, 5 dias, 60 dias) estão em `lib/prazos.ts` — mude ali se quiser ajustar.

## 2. O que está implementado de verdade

| Peça | Arquivo | Estado |
|---|---|---|
| Cálculo de prazos e diagnóstico de status | `lib/prazos.ts` | ✅ Funções puras, fácil de testar |
| Cálculo automático de data-limite (+30 dias) | `db/migrations/0001_initial.sql` (trigger) | ✅ No banco, não depende da aplicação lembrar de calcular |
| Cadastro de clientes (prefeituras) | `app/(protegido)/clientes`, `app/api/clientes` | ✅ |
| Emissão/registro de nota fiscal | `app/api/notas` | ✅ (a emissão real via API de NFS-e — Focus NFe/Nuvem Fiscal/eNotas — é TODO, ver Seção 3) |
| Fila de checagem manual do atesto | `app/(protegido)/checagem`, `app/api/notas/[id]/verificar` | ✅ |
| Job diário de recálculo + alertas | `app/api/cron/verificar-prazos` | ✅ (precisa ser agendado — ver Seção 4) |
| Notificação ao time de cobrança | `lib/notificacao-interna.ts` | ✅ E-mail transacional via Resend, HTML (canal único — falta só configurar `RESEND_API_KEY`) |
| E-mail automático pro contato da prefeitura cliente (4 estágios, tom institucional, BCC pro time interno) | `lib/notificacaoCliente.ts` | ✅ Só na transição de estado (ver Seção 6) |
| Dashboard e lista de alertas | `app/(protegido)/page.tsx`, `app/(protegido)/alertas` | ✅ |
| Login da equipe NEXAIGEN (bcrypt + JWT, sem papel/hierarquia) | `lib/auth.ts`, `app/login`, `app/api/auth/*` | ✅ Toda rota/página protegida (ver Seção 7) |
| Gestão da própria equipe (listar/cadastrar colega) | `app/(protegido)/equipe`, `app/api/equipe` | ✅ Qualquer colega logado pode cadastrar outro |

## 3. O que falta antes de produção (TODO explícito)

- **Emissão automática de NF**: hoje `POST /api/notas` só registra a nota no seu controle — não
  emite a NFS-e de verdade. Integrar com Focus NFe, Nuvem Fiscal ou eNotas (todas cobrem milhares
  de municípios via uma única API, incluindo o novo padrão NFS-e Nacional).
- **Envio ao portal da prefeitura**: continua manual/semi-manual — não existe API única para os
  sistemas de fornecedor de cada prefeitura (Betha, e-Cidade, Publica, Elotech...). Ver a conversa
  sobre escalar a fila de checagem com equipe conforme o número de clientes cresce.
- **E-mail de cobrança**: `lib/notificacao-interna.ts` já envia via Resend — falta só criar a conta,
  verificar o domínio remetente e preencher `RESEND_API_KEY` no `.env.local`/produção.
- **Senha de portal**: de propósito, não existe campo de senha no banco (`cliente_prefeitura` só
  guarda usuário/URL/sistema). Usar um gerenciador de senhas de equipe (1Password/Bitwarden).

## 4. Setup local (custo zero, Postgres direto — mesma arquitetura do nexaigen-educa)

```bash
npm install
docker compose up -d   # Postgres 16 na porta 5435 (nexaigen-educa já usa a 5434 — os dois rodam juntos)
npm run migrate          # aplica db/migrations/*.sql em ordem, uma transação por arquivo
```

Configure `DATABASE_URL`/`JWT_SECRET` em `.env.local` (baseado em `.env.example`) — o valor padrão
de `DATABASE_URL` já aponta pro Postgres do compose acima.

```bash
npm run dev   # roda na porta 3001 (o nexaigen-educa usa a 3000 — dá pra rodar os dois juntos)
```

Sem login nenhum ainda cadastrado, acesse `/login` e vai dar 401 — rode o bootstrap (Seção 7) pra
criar a primeira conta antes de usar a plataforma.

## 5. Agendando o job diário (produção)

A hospedagem é **Railway** — por isso o agendamento NÃO fica no `vercel.json` (removido na rodada 07:
cron da Vercel não dispara fora da Vercel). Quem agenda é o GitHub Actions:
`.github/workflows/verificar-prazos.yml` faz, todo dia às 09:00 UTC (06:00 em Brasília), um `POST` em
`/api/cron/verificar-prazos` com `Authorization: Bearer <CRON_SECRET>` e imprime no log o resumo da
execução (notas avaliadas, alertas criados, e-mails enviados/falhos). Também dá pra disparar à mão
pela aba Actions (`workflow_dispatch`).

**Secrets do repositório (Settings > Secrets and variables > Actions) — obrigatórios em produção:**

| Secret | Valor |
|---|---|
| `FINANCEIRO_URL` | URL pública do Financeiro no Railway, sem barra no fim |
| `CRON_SECRET` | o MESMO valor da variável `CRON_SECRET` do serviço no Railway |

Sem os dois, o workflow só avisa e termina com sucesso (nada é executado). Até 3 tentativas, só em
erro transitório (rede, 5xx, 429); 401 falha na hora. Para testar manualmente
antes do deploy:

```bash
curl -X POST http://localhost:3001/api/cron/verificar-prazos \
  -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
```

## 6. E-mail automático pro cliente (prefeitura) — decisões de design

Desde a rodada de "e-mails bem lindos e cobrança automática", o job diário não avisa mais
só o time interno — `lib/notificacaoCliente.ts` manda um e-mail direto pro contato da
prefeitura (`cliente_prefeitura.contato_email`) em cada um dos 4 estágios de
`TipoAlerta` (`sem_atesto_prolongado`, `proximo_vencimento`, `vencido`, `atraso_60_dias`),
sempre com BCC pro e-mail interno de cobrança.

**Decisão 1 — tom institucional, nunca ameaça.** É uma prefeitura, cliente da própria
NEXAIGEN, não um devedor comum. Nenhum dos 4 textos (ver `lib/notificacaoCliente.ts`)
contém afirmação jurídica ou ameaça ("vamos protestar", "medidas legais" etc.), mesmo no
estágio mais avançado — o tom escala de neutro/prestativo até mais sério, mas sempre
convidando ao diálogo. Se a redação precisar mudar, mude em `montarConteudo()` naquele
arquivo — é o único lugar que decide o que sai em nome da empresa pra um cliente externo.

**Decisão 2 — dispara só na TRANSIÇÃO de estado, nunca todo dia.** Mandar o mesmo aviso
repetido todo dia pra uma prefeitura, enquanto a nota continuar no mesmo estágio, tende a
ser ruim pra relação com o cliente. Em vez de criar uma coluna nova de controle (tipo
`ultimo_alerta_cliente_enviado` por nota), a rodada reaproveitou um mecanismo que já
existia: `alerta_cobranca` tem um índice único parcial (`uq_alerta_ativo`,
`nota_fiscal_id`+`tipo`, `where status <> 'resolvido'`), e `app/api/cron/verificar-prazos`
já fazia um `insert ... on conflict (nota_fiscal_id, tipo) where status <> 'resolvido' do
nothing returning id` nessa tabela pra decidir quando notificar o time interno
(historicamente só no tipo `atraso_60_dias` — o insert em si era um `upsert` do Supabase com
`ignoreDuplicates: true` antes da rodada de migração de infraestrutura, mesmo efeito). O
RETURNING só traz a linha quando ela foi **realmente inserida agora** — rodar o job duas
vezes no mesmo dia (ou todo dia seguinte, enquanto o estágio não mudar) faz a segunda
tentativa ser ignorada silenciosamente pelo `on conflict`, sem devolver linha, e o e-mail ao
cliente simplesmente não é chamado de novo. Essa mesma checagem foi só ESTENDIDA pra também
disparar `notificarClientePrefeitura` nos 4 tipos, não inventada do zero — ver o comentário
no topo de `app/api/cron/verificar-prazos/route.ts` e de `lib/notificacaoCliente.ts`.

**Por que nenhuma coluna nova foi necessária**: uma coluna de controle separada
duplicaria uma fonte de verdade que já existe (`alerta_cobranca` em si) e poderia divergir
dela — por exemplo, se um alerta for marcado `resolvido` manualmente e depois reaberto
(o índice único exclui `resolvido`, então um novo `insert` é permitido de propósito, pra
cobrir o caso de "o time resolveu manualmente, mas a nota continua sem pagamento e o
mesmo tipo de alerta reaparece depois"), a coluna de controle teria que ser resetada em
sincronia com isso, ou o comportamento divergiria do que `alerta_cobranca` já registra.
Reaproveitar o próprio índice único evita esse problema por construção.

**`cliente_prefeitura.contato_email` já existia no schema** — não foi necessária nenhuma
migração para este recurso. Se ficar vazio pra algum cliente, o e-mail simplesmente não é
enviado pra aquele cliente (`console.warn`, nunca lança) — vale conferir que todo cliente
ativo tem esse campo preenchido antes de confiar no recurso em produção.

## 7. Login da equipe NEXAIGEN — achado crítico de segurança, corrigido

Até uma rodada anterior, esta plataforma não tinha login nenhum: `usuario_interno` (pensada pra
isso) nunca foi lida/checada em nenhuma rota — confirmado por busca no repo inteiro antes de
decidir removê-la (zero ocorrências fora do próprio schema). Toda API e toda página estavam
completamente abertas.

**Um tipo de usuário só, sem papel/hierarquia.** Diferente do nexaigen-educa (que vende o produto
a cada prefeitura, com papéis cidadão/servidor/gestor/admin), este projeto é 100% interno — só
existe "equipe NEXAIGEN". Qualquer pessoa já logada pode cadastrar outra (`POST /api/equipe`), sem
aprovação nem papel especial.

**`equipe_nexaigen`/`sessao`** — bcrypt custo 12 pra senha, JWT HS256 (`jose`) 15min de access
token, refresh token de 7 dias com hash sha256 gravado em `sessao`, cookies httpOnly. Ver
`lib/auth.ts` pro contrato completo (mesmo espírito do `lib/auth.ts` do nexaigen-educa, mas sem
multi-tenant).

**Verificação desta rodada**: `npm run test` (66 testes, incluindo `app/api/protecao-rotas.test.ts`
— confirma que TODA rota antes aberta agora exige sessão, 401 sem cookie, e que
`/api/cron/verificar-prazos` continua funcionando só com `CRON_SECRET`), `tsc --noEmit` limpo,
`next build` compila.

## 8. Migração de infraestrutura — Supabase → Postgres direto

Pedido explícito da Luana: mesma arquitetura de banco do projeto irmão `nexaigen-educa` — Postgres
via `DATABASE_URL`/`pg`, sem depender de um projeto Supabase configurado à parte. Isso não é só
preferência: um projeto Supabase antigo e esquecido, com a URL nunca preenchida em `.env.local`,
foi exatamente o que bloqueou o primeiro login real por uma rodada inteira.

**`usuario_interno` dropada de vez, sem a dança incremental que o `supabase/schema.sql` antigo
fazia** (`create → drop usuario_interno → repontar FK`) — banco NOVO, nunca teve dado real
(confirmado de novo antes desta rodada: só existiu aquele projeto Supabase esquecido, nunca usado).
`db/migrations/0001_initial.sql` cria o schema final direto: `equipe_nexaigen`/`sessao` +
`cliente_prefeitura`/`nota_fiscal`(+trigger)/`evento_verificacao`/`alerta_cobranca`(+índice único
parcial), mesmas colunas/constraints/defaults de antes, sem RLS/policies — RLS é um conceito do
Supabase (anon vs. service_role na borda do PostgREST) que não existe pra um Postgres acessado só
via `DATABASE_URL` da própria aplicação; recriar algo parecido seria teatro de segurança, já que
`lib/auth.ts#exigirSessao()` é o controle de acesso real desde a rodada anterior.

**`lib/db.ts`** — mesmo contrato de `nexaigen-educa/lib/db.ts` (Pool cacheado em `globalThis`,
`query<T>(sql, params, executor?)`, `withTransaction(fn)`). Três type parsers preservam o MESMO
formato de resposta que o cliente Supabase já produzia (ver o comentário completo no topo do
arquivo pra evidência de cada um, não suposição): `bigint`/int8 (só `token_version`) → `Number(...)`
(o driver "pg" devolve int8 como string por padrão — sem isto, `"3" !== 3` quebraria todo login);
`date` → devolvido como a string crua do protocolo, sem virar `Date` (evita `data_emissao` virar um
datetime completo no texto que `app/(protegido)/checagem` já interpola direto); `timestamptz` →
ISO 8601 completo, igual ao `nexaigen-educa`. `numeric` não precisou de parser nenhum — o driver
"pg" já devolve como string por padrão, exatamente como o Supabase, confirmado pelo frontend já
envolver todo campo monetário em `Number(...)`.

**Bootstrap da primeira conta** (`scripts/bootstrap-equipe-nexaigen.ts`) agora usa `query()` de
`lib/db.ts` — na rodada anterior usava `supabaseAdmin()` porque era a única forma de acesso a
banco que o projeto tinha:

```bash
NOME="Seu Nome" EMAIL="voce@nexaigen.com.br" \
  npx tsx --env-file-if-exists=.env --env-file-if-exists=.env.local \
  scripts/bootstrap-equipe-nexaigen.ts
```

Depois da primeira conta, toda conta nova vem de `/equipe` (sessão já logada) — o script nunca
precisa rodar de novo.

**Verificação**: `npm run test`/`npm run test:integration` (novo — primeira suíte de integração
deste projeto contra Postgres real, ver `vitest.integration.config.ts`), `tsc --noEmit` limpo,
`next build` compila. `db/migrations/0001_initial.sql` testado de verdade contra um Postgres 16
limpo via Docker (sem Supabase), rodado duas vezes seguidas — aplica sem erro num banco novo e é
idempotente rodado de novo num banco já migrado (achado real nessa checagem, não hipotético: a
primeira versão do arquivo tentava repontar as 2 FKs pra `equipe_nexaigen` antes das tabelas
`evento_verificacao`/`alerta_cobranca` existirem — corrigido reordenando o arquivo).

**Resultado final, tudo rodado de verdade nesta rodada (não só lido/inferido):**
- `npx tsc --noEmit` — 0 erros.
- `npm run test` — **73 testes unitários** passando (os 3 arquivos que mockavam
  `@/lib/supabase/server` — `lib/auth.test.ts`, `app/api/protecao-rotas.test.ts`,
  `app/api/cron/verificar-prazos/route.test.ts` — agora mockam `@/lib/db`, mesma cobertura de
  antes, nenhum caso removido). `vitest.config.ts` ganhou `exclude: ["**/*.integration.test.ts"]`
  (mesmo padrão do `nexaigen-educa`) — sem isso os 2 arquivos de integração novos entravam também
  na suíte unitária e quebravam por falta de `DATABASE_URL`.
- `npm run build` — compila limpo, 17 páginas/rotas geradas (nenhuma mudou nesta rodada).
- `npm run test:integration` (com Postgres local do `docker-compose.yml`, porta `5435`, já
  migrado) — **6 testes novos, todos passando**: `lib/db.integration.test.ts` (trigger
  `calcular_data_limite` em INSERT e em UPDATE; `uq_alerta_ativo` barrando um segundo INSERT do
  mesmo alerta ativo e liberando de novo depois de resolvido) e
  `app/api/cron/verificar-prazos/route.integration.test.ts` (fluxo completo: nota vencida há 95
  dias → 1º run gera alerta `atraso_60_dias` + chama as duas notificações [mockadas] → 2º run no
  mesmo dia não duplica nem renotifica → resolver manualmente libera um novo ciclo).
- **Confirmado com uma inserção real, não só por inspeção do código do projeto irmão**: o driver
  `pg` reporta violação de unicidade com `erro.code === "23505"` e
  `erro.constraint === "equipe_nexaigen_email_unico"` — exatamente o que `app/api/equipe/route.ts`
  já checava. Testado literalmente (script descartável, removido depois) contra o Postgres local.
- **Passo a passo manual completo, servidor real (`next build && next start -p 3001`) contra o
  Postgres local**: bootstrap → login com senha temporária → troca de senha obrigatória (e
  confirmação de que o `token_version` bumped invalida a sessão anterior, exigindo login de novo)
  → `POST /api/clientes` → `POST /api/notas` → `POST /api/notas/[id]/verificar` (trigger calculou
  `data_limite_pagamento` certo, `verificado_por` gravado com o id real da sessão) → atesto
  rebaixado manualmente pra 95 dias atrás → `POST /api/cron/verificar-prazos` (com `CRON_SECRET`)
  → `GET /api/alertas` mostrando o alerta com o formato aninhado esperado
  (`alerta.nota.cliente.nome`, `valor` como número real, `data_limite_pagamento` como string de
  data crua). Todas as 5 páginas protegidas (`/`, `/alertas`, `/checagem`, `/clientes`, `/equipe`)
  responderam 200 com a sessão real. Dado de teste removido do banco ao final.
- **Reconfirmado, como pedido**: não há migração de dado a fazer. O único projeto Supabase que já
  existiu nunca teve a URL preenchida em `.env.local` — ninguém jamais conseguiu logar através
  dele, então não há como (nem o que) exportar de lá; o banco criado por `0001_initial.sql` é
  genuinamente novo, sem histórico a preservar.

**Pendências/decisões documentadas, não implementadas sem perguntar (conforme instrução
explícita da Luana — "onde houver dúvida entre preservar comportamento idêntico e melhorar,
preserve e documente"):**
- Um erro de infraestrutura genuíno (ex.: conexão caiu) durante `trocarSenha` agora propaga como
  exceção real (→ 500) em vez de potencialmente ser confundido com "conta não encontrada"/"senha
  errada" sob o padrão antigo `{data, error}` do Supabase — nunca exercitado na prática (é um
  cenário de falha de infra, não de negócio), mas é uma nuance de comportamento real, não uma
  regressão funcional. Documentado em `lib/auth.ts` e coberto por um teste dedicado.
- `nota.valor`/`alerta.nota.valor` chegam como `string` do driver `pg` (igual o Supabase antes) —
  a rota do cron já envolvia em `Number(...)` antes de passar pras funções de notificação, mantido
  como estava; nenhum novo lugar precisou desse cast que já não tivesse.
- Nenhuma otimização de performance foi tentada nesta rodada (era migração de infraestrutura, não
  de funcionalidade) — não há `scripts/teste-carga-*` para este projeto ainda, ao contrário do
  `nexaigen-educa`; fica como possível pendência futura se o volume de notas/clientes crescer.

## 9. Upload do PDF da nota fiscal

Pedido da Luana: guardar o PDF da NF-e junto do registro de cada nota. Este sistema não emite
NF-e — ela já é emitida fora (prefeitura/contador) — só guarda o arquivo. `lib/armazenamentoObjetos.ts`
foi **reaproveitado tal e qual** do projeto irmão `nexaigen-educa` (mesmo módulo, mesmas env vars
`RAILWAY_BUCKET_*`, mesmo contrato de robustez — nunca lança, sempre `false`/`null` em falha) — não
existia nenhuma rodada anterior de upload de PDF neste projeto (contrato de cliente ou qualquer
outro), então não havia um segundo módulo pra evitar duplicar; este é o primeiro.

**`0002_nota_fiscal_arquivo_pdf.sql`** adiciona `arquivo_pdf_chave`/`arquivo_pdf_nome` (ambos
nulos até o primeiro anexo) — só metadados; o arquivo em si vai pro bucket privado, nunca pro
Postgres.

**`POST`/`GET /api/notas/[id]/arquivo`** exigem sessão (`exigirSessao`, mesmo padrão de toda outra
rota deste projeto). O upload valida, nesta ordem: nota existe (404) → `Content-Type ===
"application/pdf"` (400) → tamanho ≤ 10MB (400) → **assinatura real do arquivo** (`%PDF-` nos 5
primeiros bytes, 400 se não bater) — só depois disso chama `uploadArquivo()`. Essa checagem de
assinatura é **mais rigorosa** que o precedente de prestação de contas de convênio em
`nexaigen-educa` (que só confere Content-Type + extensão do nome do arquivo, nunca o conteúdo
real) — decisão deliberada, porque o pedido desta rodada especificou explicitamente conferir a
assinatura, não porque o precedente estivesse errado pro caso dele. O download nunca devolve a
chave do objeto nem uma URL direta, e dá 404 se a nota não tiver PDF anexado. *(Desde a Seção 12 o
download passa pelo próprio servidor, sem presigned URL.)*

**Chave do objeto e substituição**: *superado pela Seção 12* — a pendência do objeto órfão a cada
reenvio foi resolvida com histórico de versões (decisão: manter todas as versões).

**UI**: `app/(protegido)/checagem/page.tsx` — única tela deste projeto que já lista notas fiscais
individualmente (com uma linha por nota e ações por linha), então foi onde o botão "Anexar/Trocar
PDF" e o link "📄 Ver nota fiscal" (quando já existe um arquivo) entraram. **Limitação conhecida,
documentada, não implementada sem perguntar**: essa tela só lista notas com `status =
'aguardando_atesto'` (é uma fila de checagem, não uma listagem geral) — uma nota já atestada/paga
não tem hoje NENHUMA tela que a liste individualmente, então seu PDF só pode ser anexado/trocado
via chamada direta à API depois que ela sai dessa fila. Não existe ainda uma tela "Notas Fiscais"
que liste todas — construir uma era uma mudança de escopo maior que o pedido desta rodada
("encontre a tela onde já são listadas"), então ficou de fora; recomendação pra próxima rodada se
isso for um problema real no dia a dia.

**Verificação real, tudo rodado nesta rodada:**
- `npx tsc --noEmit` — 0 erros.
- `npm run build` — compila limpo, rota `/api/notas/[id]/arquivo` aparece na lista de rotas.
- `npm run test` — **98 testes unitários** (73 de antes + 25 novos): `lib/armazenamentoObjetos.test.ts`
  (13 casos, adaptado do arquivo homônimo em `nexaigen-educa`, SDK da AWS mockado) +
  `app/api/notas/[id]/arquivo/route.test.ts` (12 casos: upload válido, nota inexistente,
  Content-Type errado, assinatura de PDF inválida mesmo com Content-Type correto, arquivo grande
  demais, armazenamento indisponível [502], corpo não-multipart, campo ausente, e os 4 cenários de
  download) — mais 2 casos novos em `app/api/protecao-rotas.test.ts` confirmando 401 sem sessão
  pras duas rotas novas.
- `npm run test:integration` — **7 testes** (6 de antes + 1 novo): confirma
  `arquivo_pdf_chave`/`arquivo_pdf_nome` nascendo `null` e persistindo de verdade depois de um
  `UPDATE`, relidos numa consulta separada (não só o `RETURNING` da própria escrita).
- **Checagem manual contra servidor real (`next build && next start`) + Postgres local**: login →
  criar cliente → criar nota → `POST /api/notas/[id]/arquivo` com um PDF de verdade (`%PDF-1.4`
  real, gerado localmente) — como este ambiente não tem credenciais reais de um bucket Railway
  configuradas (`RAILWAY_BUCKET_*` vazias, o mesmo estado documentado como aceitável em
  `nexaigen-educa`), o upload devolveu **502 "Armazenamento indisponível"** — confirmado que isso é
  uma falha graciosa (nunca uma exceção não tratada) e que **nada foi gravado** em
  `arquivo_pdf_chave`/`arquivo_pdf_nome` nesse caso (conferido direto no Postgres). Também
  confirmado nesta checagem real: um arquivo com `Content-Type: application/pdf` mas conteúdo
  falso é recusado com 400 antes de qualquer tentativa de upload; a mesma chamada sem cookie de
  sessão devolve 401; `GET` numa nota sem arquivo anexado devolve 404; `GET /api/notas` já retorna
  as duas colunas novas (via `nf.*`, sem precisar editar aquela rota).
- **Não verificado nesta rodada, documentado como limitação**: o caminho de SUCESSO real de
  upload/download (contra um bucket Railway de verdade) não foi exercitado — não há credenciais
  reais disponíveis neste ambiente. O caminho de sucesso está coberto nos testes unitários (SDK
  mockado) e é o mesmo módulo já em uso em produção-equivalente pelo `nexaigen-educa` — mas a
  integração real com um bucket Railway configurado para ESTE projeto ainda precisa ser confirmada
  manualmente quando as credenciais existirem.
- **Não verificado nesta rodada, documentado como limitação**: a interface (clicar em "Anexar
  PDF", ver o rótulo do botão mudar pra "Trocar PDF", ver a mensagem de erro renderizada) não foi
  conferida visualmente num navegador — a extensão Chrome não estava conectada neste ambiente. A
  integração API↔UI foi confirmada indiretamente (o formato de dados que a UI consome de `GET
  /api/notas` já inclui as colunas novas; `tsc`/`next build` confirmam que o JSX compila e os tipos
  batem) mas não substitui uma conferência visual real — recomendo um teste manual rápido no
  navegador antes de considerar a UI pronta pra uso.

## 10. Integração com o nexaigen-educa + contrato da prefeitura

Ao provisionar um município novo no `nexaigen-educa`, o Educa chama **`POST /api/integracao/clientes`**
aqui pra criar/atualizar o `cliente_prefeitura` correspondente (bancos continuam SEPARADOS — sem SSO,
sem banco compartilhado). Esta rodada é só o lado Financeiro; o lado Educa (formulário no wizard +
chamada de saída) é a próxima.

- **Autenticação**: só `Authorization: Bearer <INTEGRACAO_SECRET>`, comparado em tempo constante —
  mesmo padrão do `CRON_SECRET`, nunca sessão de equipe. É o MESMO valor configurado como
  `INTEGRACAO_FINANCEIRO_SECRET` no Educa. Segredo ausente no servidor → 401 + alerta de sistema
  (`alertarErroSistema`, categoria `integracao_educa`); segredo errado → só 401, sem alerta.
- **Idempotência**: `0004_integracao_educa.sql` adiciona `municipio_id_externo` (uuid do município no
  Educa, sem FK — bancos diferentes) com índice único parcial (`where ... is not null`). A rota faz
  `insert ... on conflict ... do update` numa query só: retry do Educa vira UPDATE (`criado: false`),
  e no UPDATE só os campos enviados mudam (opcional ausente mantém o valor salvo).
- **Contrato** (opcional, base64 no JSON): base64 válido, ≤10MB decodificado e assinatura `%PDF-` —
  qualquer falha é 400 (nunca ignorado). Se o upload no bucket falhar, o cliente é salvo mesmo assim,
  sem contrato, com `avisoContrato` na resposta. Chave `financeiro/contratos-prefeitura/{uuid}/{nome}` *(desde a Seção 16: cada contrato é uma versão, chave `.../{clienteId}/versoes/{uuid}/{nome}`)*.
- **Uso pela equipe** (sessão): `GET`/`PATCH /api/clientes/[id]` (PATCH só atualiza o que vier;
  `municipio_id_externo`/`contrato_arquivo_*` não são editáveis por ali), `POST`/`GET
  /api/clientes/[id]/contrato` (multipart, mesmas regras de PDF; download pelo servidor em streaming —
  Seção 18). Tela `/clientes`: botão Editar, campo Observação e o contrato com versões (Seção 16).
- Regras de PDF compartilhadas entre nota fiscal e contrato em `lib/validacaoPdf.ts`; schema zod
  compartilhado entre as 3 rotas de cliente em `lib/clienteSchema.ts`.

**Pendências conhecidas, não implementadas:**
- ~~Contrato substituído deixa o objeto antigo órfão no bucket~~ — resolvido na Seção 16 (contrato com histórico de versões) —
  um job de limpeza futuro resolveria se isso crescer.
- Não existe forma de "desvincular" um cliente do município do Educa (limpar `municipio_id_externo`
  manualmente). Se um município for recriado do zero no Educa **com o mesmo id**, o próximo POST de
  integração dá UPDATE, não INSERT — correto, mas vale saber. (Um município recriado com id NOVO cria
  um segundo cliente — o antigo continua lá, vinculado ao id velho.)
- ~~Não há rate limiter neste projeto~~ — resolvido na rodada 07 (Seção 13): a rota de integração
  limita 60 req/min e 10 falhas de autenticação/15 min por IP.
- Falha no upload do contrato via integração já é alertada pelo próprio `lib/armazenamentoObjetos.ts`
  (categoria `railway_bucket`) — não é alertada uma segunda vez como `integracao_educa`.

## 11. Painel financeiro

**`/painel`** (e `GET /api/painel-financeiro`, `?formato=csv` pro CSV): MRR, recebido no mês, a receber (no prazo/vencido/crítico), inadimplência e prazo médio de 12 meses, notas sem atesto há >15 dias, série faturado (por competência) x recebido (por mês de pagamento) e tabela de clientes com situação — cálculo puro em `lib/painelFinanceiro.ts` (centavos inteiros, datas em America/Sao_Paulo, status derivado via `diagnosticarNota` na data de hoje), leitura em `lib/painelFinanceiroRepositorio.ts`.

## 12. Histórico de versões do PDF da nota fiscal

Cada envio de PDF da nota vira uma versão nova em `nota_fiscal_arquivo_versao` (`0005_nota_fiscal_arquivo_versao.sql`, com backfill da v1 das notas legadas): chave própria por envio no bucket, sha256/tamanho/autor/motivo gravados, nunca apaga versão nem objeto; `nota_fiscal.arquivo_pdf_chave/nome` continua apontando pra atual; download por `GET /api/notas/[id]/arquivo?versao=N` (passa pelo servidor), histórico em `GET /api/notas/[id]/arquivo/versoes`, UI na Fila de Checagem.

## 13. Segurança, agendamento e CI (rodada 07)

Limite de tentativas em Postgres (`lib/rateLimit.ts`, `0006_rate_limit.sql`): login 5 falhas/15 min por e-mail e por IP (429 + Retry-After; e-mail inexistente custa o mesmo tempo que senha errada), troca de senha 10/15 min, integração 60/min e 10 falhas de autenticação/15 min por IP; debounce do alerta de sistema realmente atômico (`0007`); job diário agendado pelo GitHub Actions (ver Seção 5); aviso no Dashboard do que falta configurar (`GET /api/configuracao/status`, só sim/não, nunca valores); CI com Postgres rodando também os testes de integração; testes isolados de Resend/bucket (`vitest.setup.sem-apis-externas.ts`).

## 14. Tela de Notas fiscais (rodada 08)

`/notas` lista TODAS as notas (filtros por situação/cliente/competência, busca por número, ordenação e paginação no servidor — `GET /api/notas`, uma query só) e cria nota (valor sempre como texto → centavos, competência normalizada pro 1º do mês, cliente precisa estar com contrato ativo, número único por cliente — `0008_nota_fiscal_ciclo_de_vida.sql`). Ações com confirmação (`POST /api/notas/[id]/acoes`): atesto, pagamento (**só depois do atesto** — Lei 14.133, Art. 141), cancelar e reabrir pagamento (motivo obrigatório), validadas pela máquina de estados pura `lib/estadoNota.ts` e aplicadas em transação com a nota travada (`lib/notasServico.ts`); histórico com autor em `GET /api/notas/[id]/eventos` (`nota_fiscal_evento`). A Fila de Checagem usa as mesmas rotas e regras (`/verificar` também virou uma transação só; "paga" sem atesto agora é 409).

## 15. Uma única fonte de números (rodada 08)

Dashboard, Painel e `/api/painel-financeiro` usam a mesma função (`lib/resumoDashboard.ts` → `obterPainelFinanceiro`): situação derivada pela data de hoje (`lib/estadoNota.ts`), centavos inteiros (`lib/dinheiro.ts`). Teste de integração confere Dashboard × API iguais em cada passo do ciclo de vida da nota.

## 16. Contrato da prefeitura versionado (rodada 08)

Mesmo padrão e mesma implementação do PDF da nota (`lib/versionamentoPdf.ts`, `0009_cliente_contrato_versao.sql` com backfill da v1): nada sobrescrito nem apagado, `?versao=N`, `GET /api/clientes/[id]/contrato/versoes`, UI com versão atual/histórico/confirmação em Clientes. O contrato que chega pela integração com o Educa vira versão nova (autor nulo, motivo com a origem).

## 17. Hash das versões legadas (rodada 08)

`npm run recalcular-hash-versoes` preenche sha256/tamanho das versões (nota e contrato) vindas de backfill, lendo o objeto em streaming; idempotente, uma falha não para as outras, relatório ok/objeto ausente/erro (saída 1 só se houve erro).

## 18. Download em streaming (rodada 08)

Downloads de PDF passam do bucket pra resposta sem carregar o arquivo em memória (`armazenamentoObjetos.abrirLeituraArquivo` → `respostaDownloadPdf`), com `application/pdf`, nosniff, no-store e nome sanitizado — **sem Content-Length** desde a rodada 13-A (o Next 16.4.5+ descarta content-length/content-encoding de route handlers, GHSA-pc58-hwjq-p385; a resposta sai chunked e, se o bucket cair no meio, o Next destrói a conexão — o navegador vê o download incompleto; `lib/downloadPdfNoServidorNext.test.ts` prende isso rodando o `sendResponse` real do Next); bucket fora do ar → 502 sem corpo de PDF; objeto que sumiu → 404.

## 19. Testes de tela (rodada 08)

`npm run test:component` (vitest + jsdom + Testing Library, também no CI): Notas, Checagem, Clientes, Painel e Dashboard. Ciclo de vida completo da nota (criar → atestar → pagar → reabrir; criar → cancelar) em `app/api/notas/ciclo-de-vida.integration.test.ts`.

## 20. Versão do Next.js e política de segurança de dependências (rodadas 09-A e 13-A)

**Next.js 16.4.6** (rodada 13-A — era 16.4.3; corrige o GHSA-mfr8-8qww-v76h e os demais avisos da 16.4.5) (fixado, sem `^`; `eslint-config-next` na mesma versão). Política: **patch de segurança do Next aplicado em até 7 dias** após a publicação do aviso. O CI roda `npm audit --omit=dev --audit-level=high` como passo **bloqueante** (alta/crítica em dependência de produção falha o job) e `npm audit` completo como informativo. Lock regenerado sempre com **npm 10.9** (o do CI) e validado com `rm -rf node_modules && npm ci`. `overrides.vitest` em `package.json` fixa todo vitest da árvore na mesma faixa da raiz — sem ele o npm 10.9 quebra (`Cannot read properties of null (reading 'edgesOut')`) num ciclo de peers opcionais `vite → @vitejs/devtools → devtools-vitest → vitest@*`. Otimização de imagens desligada (`images.unoptimized` em `next.config.js`): o projeto não usa `next/image` nem `next/og`, e o endpoint `/_next/image` (ponto de entrada de avisos de RCE/SSRF) passa a responder 404.

## 21. Zod 4 (rodada 10-A)

Migrado de zod 3.25 para **zod 4.6.7** (corrige GHSA-mrhx-c7xc-m3w5 — `npm audit --omit=dev` limpo). O contrato das respostas 400 não mudou: `detalhes` continua `{ formErrors, fieldErrors }`, montado num lugar só (`lib/validacao.ts#detalhesDoErro`, sobre `z.flattenError`); só os TEXTOS padrão das mensagens do próprio zod mudaram (as mensagens do projeto são as mesmas). Cuidado documentado em `lib/clienteSchema.ts`: no zod 4 um `.default()` dentro de campo opcional é APLICADO — por isso os defaults de cliente ficam só no schema de criação (sem isso, todo PATCH gravaria plano/dia padrão). `portal_url` passou a aceitar só http/https (vira link clicável na Fila de Checagem). Regressão de contrato de todas as rotas validadas em `app/api/contrato-validacao.test.ts`.

## 22. Planos por porte de município e taxa de implantação (rodada 11-A)

**Regra de produto: o plano NÃO limita funcionalidade — todo plano dá acesso a tudo; muda só o preço.** Fonte única: `lib/planos.ts`.

| Plano | Mensalidade padrão | Faixa | Implantação e treinamento (padrão) |
|---|---|---|---|
| Dispensa | R$ 5.457,00 | — | não tem |
| Pequeno Porte | R$ 8.500,00 | Até 50 mil hab. | R$ 15.000,00 |
| Médio Porte | R$ 15.000,00 | 50 mil a 200 mil hab. | R$ 20.000,00 |
| Grande Porte | R$ 35.000,00 | Acima de 200 mil hab. | R$ 30.000,00 |

Os valores são o **padrão sugerido**: o combinado com cada prefeitura fica em `cliente_prefeitura.valor_mensal` / `taxa_implantacao` (editáveis na tela de Clientes; na criação, campo ausente = padrão do plano; trocar o plano de um cliente só repõe os padrões depois de confirmar na tela). Dispensa nunca tem taxa (o banco garante). Migration `0010_planos_por_porte.sql`: clientes `essencial`/`completo` (só existiam de teste) viraram `dispensa` mantendo o valor; ids antigos agora dão 400 com mensagem clara — **inclusive vindos do nexaigen-educa, que precisa ser atualizado pros 4 ids novos**.

**Implantação**: cobrança ÚNICA, por uma nota de tipo `implantacao` criada À MÃO (botão "Criar nota de implantação" em Clientes e em Notas fiscais) — nunca automática, porque uma nota criada sozinha já começaria a contar prazo de atesto. Competência = mês da emissão; mesma máquina de estados e mesmos prazos (Lei 14.133, art. 141); no máximo uma nota de implantação não cancelada por cliente (409 na segunda). Até a nota existir, o cliente aparece com o selo **"Implantação a cobrar"** (Clientes, Notas, Dashboard e Painel). No Painel, a implantação tem quadro próprio (a cobrar / a receber / recebida): **não entra no MRR**, mas entra em recebido, a receber e inadimplência.


## 23. Cancelamento de contrato com aviso prévio (rodada 12-A)

**Regras (Luana):** aviso prévio fixo de **30 dias corridos** contados do **recebimento do ofício**; término = data do ofício + 30. Durante o aviso o contrato segue normal (status `em_aviso_previo`) e a mensalidade continua devida até o término. **O cancelamento não cancela dívida**: notas já emitidas continuam exigíveis — o job diário continua avaliando prazos, criando alertas e mandando os e-mails de cobrança **mesmo com o cliente encerrado**, até o pagamento. Retratação possível até a data de término.

- **Funções puras:** `lib/cancelamentoContrato.ts` (término, validações, períodos de 30 dias contados de `data_inicio_contrato`, nota final). **Escrita:** `lib/cancelamentoServico.ts` (transação com `select … for update` + evento de auditoria). **Migration** `0011_cancelamento_contrato.sql`: status `em_aviso_previo`, `cancelamento_pedido_em/termino_em/motivo` (≤ 500), CHECKs de coerência (término = pedido + 30) e a trilha `cliente_evento_contrato` (origem `painel`, `educa` ou `sistema`).
- **O dia do término ainda é dia de contrato:** o contrato vira `encerrado` no dia **seguinte** ao término (`término < hoje`, America/Sao_Paulo) e a retratação vale até o próprio dia do término. Um ofício registrado com mais de 30 dias de atraso encerra o contrato na hora (dois eventos).
- **Tela de Clientes:** selo do status em português; "Registrar cancelamento" (data do ofício + motivo; confirmação mostrando o término calculado); "Retratar cancelamento" (confirmação). Rotas: `POST`/`DELETE /api/clientes/[id]/cancelamento` (sessão; 409 em transição inválida, inclusive repetir a mesma ação).
- **Nota final:** valor = mensalidade × dias do último período ÷ 30 (arredondado ao centavo, só em centavos inteiros), pré-preenchido e editável. Competência = mês em que o último período **começa**. Aviso "Contrato em aviso prévio — término em DD/MM/AAAA" e botão "Criar nota final" em Clientes e em Notas; o botão some quando já existe mensalidade não cancelada dessa competência. Mensalidade de competência posterior → **409**. Contrato encerrado por aviso prévio ainda aceita a nota final (o job pode encerrar antes de a equipe emitir).
- **Integração com o Educa:** `POST /api/integracao/clientes/{municipioIdExterno}/cancelamento` (mesmo `INTEGRACAO_SECRET` e rate limit de `/api/integracao/clientes` — `lib/autenticacaoIntegracao.ts`) com `{acao: 'registrar'|'retratar'|'encerrar', dataPedido?, motivo?, imediato?}`. **Idempotente:** repetir a mesma ação devolve 200 com `mudou: false`, sem evento novo. Município sem cliente → 404. `encerrar` sem `imediato` só depois do término (senão 409); com `imediato: true` encerra na hora.
- **Job diário:** encerra os avisos vencidos antes de avaliar as notas, cada cliente na sua transação (falha de um → `falhasEncerramento` no resumo + alerta de sistema; os outros seguem). Resumo ganhou `contratosEncerrados` e `falhasEncerramento`.
- **Painel/Dashboard:** MRR = ativos + em aviso prévio (até o término); encerrado e suspenso saem. Cartão "Em aviso prévio" (quantidade, MRR em risco, próximo término) — mesma conta no Dashboard e no Painel. Clientes encerrados continuam na tabela com a situação financeira das notas em aberto.
- **Nota para o nexaigen-educa:** precisa chamar a rota de cancelamento quando registrar/retratar/encerrar o contrato de um município (o Financeiro não busca isso sozinho).

## 24. Perfis de acesso da equipe e relatório de novos contratos (rodada 15-A)

**Papéis** (`equipe_nexaigen.papel`, migration `0012_papel_equipe.sql`; quem já existia virou `admin`, e o primeiro login do bootstrap também nasce admin). A matriz mora em **um lugar só**, `lib/papeis.ts`, com **negação por padrão**: área nova sem regra = só admin.

| Área (tela / API) | admin | financeiro | vendas | rh |
|---|:-:|:-:|:-:|:-:|
| Página inicial (`/`) | Dashboard | Dashboard | boas-vindas | boas-vindas |
| Dashboard, Painel, Novos contratos | ✅ | ✅ | — | — |
| Notas fiscais, Fila de Checagem, Clientes, Alertas de cobrança | ✅ | ✅ | — | — |
| Equipe (cadastro e papéis), status de configuração | ✅ | — | — | — |

- **Vendas e RH** estão reservados para o CRM e o RH: hoje não veem nenhuma tela financeira, só "Bem-vindo, seu acesso de … ainda não tem módulos".
- **Financeiro** também vê o Dashboard (é a página inicial financeira) e os Alertas de cobrança (é o trabalho de cobrança). Para mudar isso basta editar uma linha de `lib/papeis.ts`.
- **API:** toda rota da equipe chama `exigirPapel(contexto, área)` (`lib/auth.ts`) e devolve 401 sem sessão ou 403 para papel sem acesso.
- **Páginas:** cada pasta de `app/(protegido)` tem um `layout.tsx` com `exigirAreaPagina(área)` (`lib/authPagina.ts`), que redireciona para `/login` sem sessão ou para `/` sem acesso.
- **NavBar:** mostra só os itens permitidos. Esconder o link é só conforto; o bloqueio de verdade está no servidor.
- **O papel é lido do banco a cada requisição**, nunca do token. Mudar o papel (tela Equipe, `PATCH /api/equipe/[id]`, só admin) também derruba as sessões da pessoa (`token_version` + sessões revogadas). O último admin ativo não pode deixar de ser admin (409).
- **Cadastro de colega:** agora exige o papel.
- **Teste de proteção:** `app/api/protecao-rotas.test.ts` cobre a matriz completa rota × papel e falha se aparecer uma rota de API sem entrada na matriz.

**Relatório "Novos contratos"** (`/contratos`; `GET /api/relatorios/novos-contratos?mes=aaaa-mm&formato=json|csv|xlsx`; admin e financeiro).
- **Regra do negócio:** a vigência começa na **assinatura**, então "novo no mês" = `data_inicio_contrato` dentro do mês. O mês padrão é o atual em America/Sao_Paulo.
- **Cartões:**
  - novos contratos, MRR novo (valor mensal combinado atual) e implantação a cobrar dos novos;
  - variação contra o mês anterior, absoluta e em % (sem base → "—", nunca divide por zero);
  - encerrados no mês (eventos `contrato_encerrado`) e em aviso prévio no fim do mês (ou hoje, no mês atual), ambos lidos da trilha `cliente_evento_contrato`;
  - saldo líquido (novos − encerrados);
  - "MRR da carteira hoje", que é a mesma conta do Painel e do Dashboard.
- **Tabela e gráfico:** tabela ordenável (prefeitura, UF, plano, valores, início, status, origem: cadastro manual ou integração Educa) e gráfico SVG dos últimos 12 meses (novos por mês + MRR novo acumulado).
- **Exportação CSV e XLSX:** os mesmos dados da tela. Cabeçalho "NEXAIGEN — Relatório de novos contratos" + mês + data de geração. CSV com BOM e `;`, fórmulas neutralizadas e variação em células numéricas. O XLSX é gerado sem dependência nova (`lib/xlsx.ts`).
- **Mês sem contrato novo:** a tela diz "Nenhum contrato novo neste mês", nunca mostra zeros fingindo dado.
- **Limitação:** encerramentos anteriores à trilha de eventos (0011) não têm evento e não entram em "encerrados no mês".

## 25. Mapa público das prefeituras atendidas (rodada 15-B)

**Regra central: só aparece quem autorizou POR ESCRITO** (cláusula de divulgação no contrato), marcado à mão na tela de Clientes. O público só vê **nome, UF e posição aproximada** do município.

- **Quem aparece:**
  - autorizado (`autorizacao_divulgacao`), com posição gravada, e com contrato **ativo** ou **em aviso prévio** ainda vigente;
  - suspenso e encerrado nunca aparecem, mesmo autorizados;
  - nenhum cliente existente foi autorizado pela migration `0013`: o padrão é `false`.
- **Código IBGE e posição (tela do cliente → seção "Divulgação pública", admin e financeiro):**
  - "Buscar posição" consulta a API pública do IBGE **só nessa hora**: nome/UF oficiais e o centroide da malha do município, com tempo-limite de 5 s;
  - grava o código e a posição no cliente;
  - se o nome/UF não bate com o cadastro, a tela avisa sem bloquear;
  - com o IBGE fora do ar, o código é salvo com **posição pendente**, e autorizar fica bloqueado até ter posição (o banco também garante, por CHECK).
- **Autorizar e revogar:** sempre com confirmação. Revogar tira do banco na hora; o cache público segura no máximo 1 minuto. Fica registrado quem autorizou e quando, e os eventos `divulgacao_autorizada`/`divulgacao_revogada` vão para a trilha `cliente_evento_contrato`.
- **Listagem de Clientes:** coluna "Mapa público", com as situações No mapa / Sem autorização / Sem código IBGE / Posição pendente / Autorizado, fora do mapa.
- **Endpoint público:** `GET /api/publico/mapa-clientes`, **sem login**.
  - Devolve só `{ atualizadoEm, total, municipios: [{ nome, uf, lat, lon }] }`.
  - Cabeçalhos: `Cache-Control: public, s-maxage=60, max-age=60`; rate limit de 120/min por IP; só GET (outros métodos → 405).
  - **Nunca chama o IBGE.**
- **Página pública:** `/mapa`, sem login e sem a NavBar interna.
  - Mapa do Brasil em SVG próprio: os contornos dos estados são um arquivo estático gerado uma vez a partir da malha pública do IBGE (`npm run gerar-mapa-brasil` → `lib/mapaBrasil.gerado.ts`). A projeção é equiretangular.
  - Pontos com nome/UF ao passar o mouse ou tocar, e lista textual para leitor de tela.
  - Sem tiles, sem Google, sem cookies, sem fontes de fora. A CSP da página proíbe qualquer recurso de outro domínio.

**Variável `MAPA_PUBLICO_ORIGENS`** (ver `.env.example`): lista de origens separadas por vírgula, por exemplo `https://www.nexaigen.com.br,https://nexaigen.com.br`.
- **O que libera:** o CORS do endpoint público e o `frame-ancestors` da página `/mapa`.
- **Vazia:** só a própria origem.
- **Valores descartados:** item inválido (sem protocolo, com caminho, `*`) é ignorado e nunca vira curinga.
- **Quando vale:** é lida em tempo de execução (`proxy.ts`), então basta reiniciar o servidor.
- **Resto do app:** continua recusando iframe (`X-Frame-Options: DENY` + `frame-ancestors 'none'`, em `next.config.js`).

**Como incorporar no site institucional** (depois de pôr a origem do site em `MAPA_PUBLICO_ORIGENS`):

```html
<iframe src="https://<endereço-do-financeiro>/mapa" title="Prefeituras atendidas pela NEXAIGEN"
        width="100%" height="720" style="border:0" loading="lazy"></iframe>
```

Ou leia o JSON direto (`fetch("https://<endereço-do-financeiro>/api/publico/mapa-clientes")`) e desenhe no próprio site.

## 26. Pendências fechadas (rodada 15-C)

- **Disputa de dois admins.** `lib/equipeServico.concorrencia.integration.test.ts` cria um **banco temporário** com nome único (`CREATE DATABASE`), aplica nele as mesmas migrations do projeto (`scripts/aplicarMigracoes.ts`, a mesma função do `npm run migrate`), coloca dois admins se rebaixando um ao outro ao mesmo tempo, em duas conexões, por 20 rodadas, e derruba o banco no fim (`DROP DATABASE … WITH (FORCE)`), mesmo se falhar.
  - Só roda com `DATABASE_URL` em localhost/127.0.0.1/::1, e nunca toca as contas reais.
  - Sempre exatamente um rebaixamento passa e o outro recebe "último admin".
  - Prova feita: sem o `for update` em `lib/equipeServico.ts`, o teste falha já na primeira rodada (os dois passam, sobra zero admin).
- **Encerrados sem evento no relatório de novos contratos.** Não há migration retroativa, porque não há data para usar:
  - antes da migration `0011` (rodada 12-A), nenhum código gravava `status_contrato = 'encerrado'` (só SQL manual), e não existia coluna de data de encerramento; um evento retroativo teria de **inventar** a data;
  - desde a `0011`, o único caminho que encerra (`lib/cancelamentoServico.ts#encerrar`) grava o evento `contrato_encerrado` na mesma transação;
  - no banco local não havia nenhum caso (0 clientes encerrados).
  - Consequência: um encerrado sem evento continua fora do MRR, mas não entra em "encerrados no mês" de nenhum mês. `lib/relatorioContratos.integration.test.ts` garante que isso não quebra o relatório.
  - **Se aparecer algum em produção, conferir à mão** com: `select id, nome from cliente_prefeitura c where status_contrato = 'encerrado' and not exists (select 1 from cliente_evento_contrato e where e.cliente_id = c.id and e.tipo = 'contrato_encerrado')`.
- **Toque no `/mapa`.** Tocar ou clicar num ponto (ou Enter/Espaço com o foco nele) abre o rótulo "Nome — UF". Tocar em outro ponto troca, tocar de novo no mesmo fecha, e tocar fora ou Esc fecha.
  - Hover e foco continuam mostrando o rótulo, e a lista textual continua lá.
  - Só os pontos são interativos (`app/mapa/PontosDoMapa.tsx`); os contornos continuam desenhados no servidor.
  - O `<svg>` passou de `role="img"` para `role="group"`: com `img`, o leitor de tela escondia os pontos, que são botões.
- **Gerador do mapa.** A parte pura (validar a malha, calcular os limites, projetar, simplificar, montar o arquivo) é `lib/geracaoMapaBrasil.ts`, testada sem rede com uma malha de 3 estados (`testes/fixtures/malha-3-estados.json`). O script ficou só "baixar → gerar → gravar". Regerado com o código novo, o `lib/mapaBrasil.gerado.ts` saiu idêntico byte a byte.

## Riscos aceitos

| Data | Risco | Por que é aceito | Quando rever |
|---|---|---|---|
| 2026-11-17 | `picomatch` (dependência **só de desenvolvimento**, via tailwindcss, vitest/vite, eslint) — advisory **GHSA-fc5q-39xc-vjpf** (ReDoS em extglobs), alto, faixa `<= 4.0.7`, **sem versão corrigida publicada** (4.0.7 é a última; as linhas 2.x/3.x também estão na faixa). O `npm audit` completo mostra 21 "high", todos dessa cadeia. | Não vai para produção: `npm audit --omit=dev` = 0. Os padrões glob vêm só da configuração do próprio projeto (tailwind/vitest/eslint), nunca de entrada de usuário. As "correções" que o npm sugere são rebaixamentos de versão principal (vitest 3, eslint-config-next 14, tailwind 4), que **não** foram aplicados (nada de `--force`). No CI, o passo **bloqueante** é `npm audit --omit=dev --audit-level=high` (só produção); a auditoria completa é informativa (`npm audit \|\| true`). | Quando sair versão corrigida do `picomatch` (acima de 4.0.7, ou 2.x/3.x corrigida): atualizar sem `--force` e sem rebaixar vitest/eslint-config-next/tailwind. |

## 27. CRM de leads (rodada 16-A)

Funil das prefeituras que **ainda não são clientes**, da primeira conversa até a negociação. **O fechamento (lead vira cliente) e as comissões ficam para as rodadas 16-B e 16-C.**

**Modelo de dados** (migration `0014_crm_leads.sql`):
- **`lead`:**
  - município, UF (27 siglas) e código IBGE opcional;
  - `nome_busca`, o nome normalizado sem acento, sem maiúscula e sem "Prefeitura de", que é a chave de duplicidade e de busca;
  - população, plano de interesse (ids de `lib/planos.ts`) e valor mensal estimado **em centavos**;
  - contato (nome, cargo, e-mail, telefone), origem, etapa e vendedor;
  - motivo e detalhe da perda (obrigatórios em `perdido`, nulos nas outras etapas);
  - próxima ação (a descrição só existe com data) e `versao` (controle otimista).
- **`lead_interacao`:** é o **histórico, somente acréscimo**. Um trigger bloqueia UPDATE, DELETE e TRUNCATE.
- **`lead_pedido_reatribuicao`:** os pedidos "Pedir este lead".
- **O banco também barra:** dois leads **abertos** do mesmo município (por código IBGE ou por UF + nome).

**Etapas:** Novo → Contato → Demonstração → Proposta → Negociação, mais Perdido.
- Entre etapas abertas, o lead pode avançar ou voltar.
- **Perder** exige motivo (preço, sem orçamento, concorrente, sem interesse, sem resposta, outro) e aceita um detalhe.
- **De Perdido só se reabre**, voltando para Contato, e o histórico registra "reabertura".
- Toda mudança grava a etapa e a linha de histórico **na mesma transação**.
- **"Ganho" existe no banco, mas NINGUÉM marca nesta rodada:** a API responde 409, "o fechamento é feito pelo fluxo de fechamento (rodada 16-B)". Não há atalho.

**Exportação:** CSV e XLSX da carteira, só admin (`crm_gestao`).
- Fórmulas neutralizadas e valor numérico com estilo moeda.
- As mesmas linhas no CSV e no XLSX com os mesmos filtros (teste abre o XLSX como ZIP).

**Quem vê o quê** (`lib/papeis.ts`: área `crm` = admin e vendas; `crm_gestao` = só admin):
- **Admin:** vê e edita todos os leads, reatribui vendedor, exporta a carteira (CSV/XLSX) e decide os pedidos de reatribuição.
- **Vendas, nos próprios leads** (aqueles em que é o `vendedor_id`): vê e edita tudo e cria leads, sempre atribuídos a si.
- **Vendas, nos leads de colegas:**
  - **só uma consulta mínima** em `GET /api/leads/consulta`: município, UF, etapa, nome do vendedor e dia da última atividade, mais `id`, `meu_lead` e `pode_pedir`;
  - nunca contato, valor, plano, origem, motivo, notas, histórico ou próxima ação;
  - qualquer outra leitura ou escrita (detalhe, editar, etapa, interação) responde **404**, nunca 403, para não permitir enumeração;
  - o filtro está **no SQL** (`lib/crmRepositorio.ts#condicaoEscopo`), e a consulta mínima é uma função própria com as colunas escritas uma a uma.
- **Financeiro e rh:** não têm acesso ao CRM (403, e o item não aparece na NavBar).

**Pedido de reatribuição:** num lead de colega **aberto e sem atividade há mais de 60 dias**, o vendedor vê "Pedir este lead".
- O pedido fica gravado e **não muda o dono**.
- O admin aprova (vira troca de vendedor, registrada no histórico) ou nega.
- Cada vendedor tem no máximo um pedido pendente por lead.
- **Pedidos concorrentes (rodada 16-A1):** ao APROVAR um pedido, todos os OUTROS pedidos pendentes do mesmo lead são fechados como "negado" com o motivo "lead já reatribuído" (coluna `motivo_decisao`, migration `0015`), na mesma transação. Isso entra no histórico do lead, no texto da troca de vendedor. Um pedido negado assim não pode ser aprovado depois (409).

**Duplicidade:**
- Criar um lead para um município que já tem lead **aberto** (por código IBGE ou nome + UF, ignorando acento e maiúscula) → 409 "Já existe esse lead: está com <vendedor>, etapa <etapa>.". A mensagem revela só isso.
- **Cliente vigente** do mesmo município → 409 "já é cliente da NEXAIGEN (contrato …)". Vigente quer dizer ativo, em aviso prévio (encerrando) ou suspenso.
- **Ex-cliente (rodada 16-A1):** município cujo cliente está com contrato ENCERRADO na data de hoje (inclusive aviso prévio com término já passado) **pode** virar lead. O lead recebe a marca "ex-cliente · encerrado em DD/MM/AAAA" no cartão, na lista e no detalhe.
  - A data vem do evento de encerramento, senão do término do aviso. Encerramento anterior à trilha aparece sem data.
  - A marca é **derivada** na leitura (`lib/crm.ts#clienteEncerrado`), sem coluna nova.
  - Cliente eliminado do cadastro não bloqueia nem marca.
- O cadastro faz a checagem de lead aberto enquanto a pessoa digita, e bloqueia o envio.
- **Concorrência:** dois cadastros (ou duas reaberturas) simultâneos do mesmo município são barrados pelos índices únicos parciais. O erro 23505 vira o mesmo 409, nunca 500. Isso é testado com duas conexões em 20 rodadas (`lib/crm.concorrencia.integration.test.ts`).

**Atividade, "parado" e "ação vencida":**
- "Última atividade" = o contato registrado (nota, ligação, e-mail, reunião, WhatsApp, visita), a mudança de etapa ou a reabertura mais recente; sem nenhuma, vale a data de criação. Editar o cadastro ou trocar o vendedor não conta.
- **Parado** = lead aberto sem atividade há **mais de 14 dias**.
- **Ação vencida** = lead aberto com próxima ação **antes de hoje**.
- Todos os dias são contados em America/Sao_Paulo.

**Taxa de avanço** (`lib/crm.ts#calcularTaxasDeAvanco`):
- A "maior etapa alcançada" de cada lead é a mais avançada entre Novo, todas as etapas novas registradas no histórico e a etapa atual. Um lead perdido conta pela etapa em que chegou.
- De X para a etapa seguinte Y: **taxa = (leads que alcançaram Y ou além) ÷ (leads que alcançaram X ou além)**.
- Pular uma etapa conta como ter passado pelas do meio.
- Sem nenhum lead em X → "—", nunca divisão por zero.
- Negociação → Ganho fica em 0 até a 16-B.

**Funil sem corte silencioso (rodada 16-A1):** os totais de cada coluna (quantidade e soma do valor estimado) vêm de agregação SQL, independentes de limite.
- Cada coluna mostra **no máximo 50 cartões** (`CARTOES_POR_ETAPA`): primeiro os de ação vencida, depois os mais antigos sem atividade; nos perdidos, os mais recentes.
- Quando a coluna tem mais leads que isso, aparece "Ver todos os N desta etapa", que abre a lista paginada já filtrada pela etapa (`/crm?visao=lista&etapa=…`).
- Nunca se vê menos do que existe sem aviso.

**Outros números:** "Ganhos no mês" aparece "—" até a 16-B. "Perdidos no mês" = leads hoje perdidos cuja perda foi registrada no mês.

**Preço:** escolher o plano de interesse sem informar o valor preenche a mensalidade padrão do plano (`lib/planos.ts`, a tabela é uma só), e o valor continua editável.

**LGPD:** o campo de notas tem o aviso fixo "Não registre dados pessoais de cidadãos, crianças ou famílias — só informações comerciais da prefeitura.".

**Testes:** o CRM é testado contra Postgres real **num banco temporário** (`testes/bancoTemporario.ts`), porque o histórico não pode ser apagado depois. Há provas de mutação: sem o filtro por vendedor, ou com campos a mais na consulta mínima, os testes falham.
