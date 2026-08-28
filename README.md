# NEXAIGEN Financeiro

Sistema interno da NEXAIGEN (não é vendido a prefeituras) para controlar contratos, emissão de
notas fiscais, checagem de atesto e escalonamento automático de cobrança. Pensado para operar em
escala — o objetivo é sustentar centenas/milhares de contratos com uma equipe pequena de checagem
manual e tudo o mais automatizado.

**Verificado nesta sessão:** `npm install`, `tsc --noEmit` (zero erros) e `next build` compilaram e
geraram as 11 páginas/rotas com sucesso.

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
```

Os limiares (20 dias, 5 dias, 60 dias) estão em `lib/prazos.ts` — mude ali se quiser ajustar.

## 2. O que está implementado de verdade

| Peça | Arquivo | Estado |
|---|---|---|
| Cálculo de prazos e diagnóstico de status | `lib/prazos.ts` | ✅ Funções puras, fácil de testar |
| Cálculo automático de data-limite (+30 dias) | `supabase/schema.sql` (trigger) | ✅ No banco, não depende da aplicação lembrar de calcular |
| Cadastro de clientes (prefeituras) | `app/clientes`, `app/api/clientes` | ✅ |
| Emissão/registro de nota fiscal | `app/api/notas` | ✅ (a emissão real via API de NFS-e — Focus NFe/Nuvem Fiscal/eNotas — é TODO, ver Seção 3) |
| Fila de checagem manual do atesto | `app/checagem`, `app/api/notas/[id]/verificar` | ✅ |
| Job diário de recálculo + alertas | `app/api/cron/verificar-prazos` | ✅ (precisa ser agendado — ver Seção 4) |
| Notificação ao time de cobrança | `lib/notificacao-interna.ts` | ✅ E-mail transacional via Resend (canal único — falta só configurar `RESEND_API_KEY`) |
| Dashboard e lista de alertas | `app/page.tsx`, `app/alertas` | ✅ |

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

## 4. Setup local (custo zero, mesmo fluxo do nexaigen-educa)

```bash
npm install
brew install supabase/tap/supabase   # se ainda não tiver
supabase init
supabase start
```

Copie as chaves impressas pelo `supabase start` para `.env.local` (baseado em `.env.example`), cole
`supabase/schema.sql` no SQL Editor do Studio local (`http://127.0.0.1:54323`), crie um usuário de
teste e um registro em `usuario_interno`.

```bash
npm run dev   # roda na porta 3001 (o nexaigen-educa usa a 3000 — dá pra rodar os dois juntos)
```

## 5. Agendando o job diário (produção)

No `vercel.json` já está configurado um cron chamando `/api/cron/verificar-prazos` todo dia às 9h.
Defina a env var `CRON_SECRET` no projeto Vercel (o próprio Vercel injeta o header
`Authorization: Bearer <CRON_SECRET>` automaticamente ao chamar o cron). Para testar manualmente
antes do deploy:

```bash
curl -X POST http://localhost:3001/api/cron/verificar-prazos \
  -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
```
