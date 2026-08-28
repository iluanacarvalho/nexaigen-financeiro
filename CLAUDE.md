# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install               # install dependencies
npm run dev                # dev server on :3001 (nexaigen-educa uses :3000 — both can run together)
npm run typecheck          # tsc --noEmit — run before considering any change done
npm run test                # vitest run — all unit tests
npx vitest run lib/prazos.test.ts             # single test file
npx vitest run -t "gera alerta crítico"        # single test by name
npm run build               # next build — also type-checks and lints
npm run lint
```

Local database (no cloud cost): `supabase init && supabase start` (requires Docker), paste `supabase/schema.sql` into the local Studio SQL editor, copy the printed keys into `.env.local` (see `.env.example`). Test the cron job manually:

```bash
curl -X POST http://localhost:3001/api/cron/verificar-prazos \
  -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
```

## Architecture

This is NEXAIGEN's own internal billing/collections tool — it is never sold to or accessed by municipalities, and its database must never be shared with `nexaigen-educa` (that repo is multi-tenant across prefeituras; this one is mono-tenant, scoped to NEXAIGEN's own team via `usuario_interno`). Purpose: track invoices sent to each contracted prefeitura through to payment, with minimal manual work as the client count grows.

**The whole domain reduces to one pure function.** `lib/prazos.ts#diagnosticarNota()` takes a nota's current state (has it been atested? when? has it been paid?) plus "now", and returns both a derived status and, optionally, which alert to raise. It has no I/O and isn't aware of Supabase — this is deliberate, since it's the one piece of business logic worth unit-testing in isolation (`lib/prazos.test.ts`). If the escalation rules change, change the thresholds/logic here first, then trace outward to the cron job.

**Legal deadline is computed in the database, not just in application code.** `nota_fiscal.data_limite_pagamento` is set by a Postgres trigger (`trg_calcular_data_limite`) the moment `data_atesto` is written — `data_atesto + 30 days` (Lei 14.133/2021, Art. 141). This means the deadline can't be wrong even if a future code path writes `data_atesto` without going through the "official" update flow.

**`app/api/cron/verificar-prazos` is the only place that mutates alert/status state in bulk.** It's meant to run once a day (Vercel Cron, `vercel.json`), authenticated by comparing the `Authorization` header against `CRON_SECRET` with `crypto.timingSafeEqual` (constant-time on purpose — this endpoint is a bearer-token-guarded bulk-write path). It scans every open nota, re-derives status via `diagnosticarNota()`, and `upsert`s alerts with `ignoreDuplicates` — the partial unique index `uq_alerta_ativo` in `supabase/schema.sql` (one active alert per nota+tipo) is what actually guarantees idempotency; the `ignoreDuplicates` flag is a secondary guard, not the source of truth. Don't add a second code path that also writes `alerta_cobranca` without going through the same upsert pattern.

**Notification is a single channel by design**: `lib/notificacao-interna.ts` sends email via Resend (`RESEND_API_KEY`) when an `atraso_60_dias` alert fires. It fails soft — if `RESEND_API_KEY` or `COBRANCA_EMAIL_DESTINO` is unset, it logs a warning and returns rather than throwing, so a missing env var never breaks the cron run. That also means a misconfigured environment sends zero notifications with no loud failure — check the Vercel/server logs, not just "did the job run".

**No portal credentials are ever stored.** `cliente_prefeitura.portal_usuario` is a login *name* only; there is deliberately no password column. Checking whether a prefeitura's portal shows a nota as atestada is a manual step (`app/checagem`) by design — see `README.md` for the reasoning and staffing math behind that choice. Don't add a password/secret field to this table without revisiting that decision explicitly.
