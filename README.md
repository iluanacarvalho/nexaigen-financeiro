# NEXAIGEN Financeiro

Sistema interno da NEXAIGEN (não é vendido a prefeituras) para controlar contratos, emissão de
notas fiscais, checagem de atesto e escalonamento automático de cobrança. Pensado para operar em
escala — o objetivo é sustentar centenas/milhares de contratos com uma equipe pequena de checagem
manual e tudo o mais automatizado.

**Verificado nesta sessão (rodada de migração de infraestrutura Supabase → Postgres direto):**
`npm install`, `tsc --noEmit` (zero erros), `next build` (17 páginas/rotas geradas), `npm run test`
(73 testes unitários, banco mockado), `npm run test:integration` (6 testes novos contra Postgres
real — trigger `calcular_data_limite`, índice único parcial `uq_alerta_ativo`, fluxo completo do
cron) e um passo a passo manual completo contra o Postgres local real (login → trocar senha →
criar cliente → criar nota → atestar → rodar cron → ver o alerta em `/api/alertas`) — ver Seção 8.

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

No `vercel.json` já está configurado um cron chamando `/api/cron/verificar-prazos` todo dia às 9h.
Defina a env var `CRON_SECRET` no projeto Vercel (o próprio Vercel injeta o header
`Authorization: Bearer <CRON_SECRET>` automaticamente ao chamar o cron). Para testar manualmente
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
