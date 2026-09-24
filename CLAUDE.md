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

Local database (no cloud cost): `supabase init && supabase start` (requires Docker), paste `supabase/schema.sql` into the local Studio SQL editor, copy the printed keys into `.env.local` (see `.env.example`, and set `JWT_SECRET` too — needed since the login round). Test the cron job manually:

```bash
curl -X POST http://localhost:3001/api/cron/verificar-prazos \
  -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
```

First login (one-time, no self-signup — see `scripts/bootstrap-equipe-nexaigen.ts`):

```bash
NOME="Sua Nome" EMAIL="voce@nexaigen.com.br" \
  npx tsx --env-file-if-exists=.env --env-file-if-exists=.env.local \
  scripts/bootstrap-equipe-nexaigen.ts
```

## Architecture

This is NEXAIGEN's own internal billing/collections tool — it is never sold to or accessed by municipalities, and its database must never be shared with `nexaigen-educa` (that repo is multi-tenant across prefeituras; this one is mono-tenant, scoped to NEXAIGEN's own team). Purpose: track invoices sent to each contracted prefeitura through to payment, with minimal manual work as the client count grows.

**ACHADO CRÍTICO DE SEGURANÇA (corrigido) — este projeto não tinha login nenhum até esta rodada.** `usuario_interno` (schema original) was meant to gate access via Supabase Auth + RLS, but was never wired to any real sign-in flow — confirmed by a full-repo grep before removing it: zero references outside `supabase/schema.sql` itself. Every API route (`/api/clientes`, `/api/notas`, `/api/notas/[id]/verificar`, `/api/alertas`) and every page (`/`, `/clientes`, `/alertas`, `/checagem`) was completely open to anyone with the URL — no session check anywhere. Replaced by a real login (`lib/auth.ts`): bcrypt + JWT (`jose`), backed by `equipe_nexaigen`/`sessao` (see `supabase/schema.sql`, Section 1). One user type, no roles/hierarchy — any logged-in teammate can create another (`POST /api/equipe`). `usuario_interno` itself was dropped (`drop table ... cascade`, plus repointing the 2 FKs that referenced it — `evento_verificacao.verificado_por`, `alerta_cobranca.atribuido_a` — to `equipe_nexaigen`).

**Every route now calls `exigirSessao(await obterContextoAutenticado(token))` first** (`lib/auth.ts`) — `obterContextoAutenticado` takes the token as an explicit parameter (never reads `next/headers#cookies()` itself), deliberately mirroring `nexaigen-educa`'s `lib/auth.ts` contract even though this project has no middleware/proxy.ts: this is what makes the function trivially unit-testable (pass a string, mock `supabaseAdmin()`) instead of crashing outside a real Next.js request scope. `exigirSessao()` ALSO blocks with 403 when `precisaTrocarSenha` is true — centralized there (not per-route, not only in the `/trocar-senha` page) since this project has no middleware layer to put that check in, and every current caller of `exigirSessao()` is a route that should be blocked by it. `/api/auth/**` never calls `exigirSessao()` (needs to work before/to get out of that state). Pages: `app/(protegido)/layout.tsx` is the page-level equivalent (Server Component, redirects to `/login` — or `/trocar-senha` if a temp password is still pending), wrapping `/`, `/clientes`, `/alertas`, `/checagem`, `/equipe` (a route group — doesn't affect the URL). `/login` and `/trocar-senha` live outside that group on purpose (can't require a session that doesn't exist yet / must render even mid-forced-password-change).

**All routes switched from `supabaseServer()` (anon key, RLS-gated) to `supabaseAdmin()` (service_role, bypasses RLS) — necessary, not cosmetic.** This login never establishes a real Supabase Auth session (`supabase.auth.signIn*` is never called anywhere), so `auth.uid()` is always `null`; RLS on `cliente_prefeitura`/`nota_fiscal`/`evento_verificacao`/`alerta_cobranca` now has **zero policies** (all 4 old ones referenced the now-dropped `usuario_interno` and were dropped with it) — RLS-enabled-with-no-policy denies everything to the anon/authenticated roles by default, a deliberate fail-closed stance kept as defense in depth even though `exigirSessao()` is the real gate now. `supabaseServer()` and the unused `supabaseBrowser()` (browser client, was already dead code — never called anywhere, confirmed by grep) were deleted outright, along with the now-unused `@supabase/ssr` dependency.

**`app/(protegido)/alertas/page.tsx` used to self-fetch its own `/api/alertas` from a Server Component** (`fetch(`${base}/api/alertas`)`) — broke the moment that route started requiring a session, since a Server Component's self-fetch to an absolute URL never forwards the incoming request's cookies automatically. Fixed by querying `supabaseAdmin()` directly instead (same pattern the dashboard page already used) rather than trying to thread the cookie header through — avoids the problem instead of working around it.

**`POST /api/notas/[id]/verificar`'s `verificado_por` used to come from the request body** (`z.string().uuid().optional()`), never checked against who actually called it — anyone could claim to be someone else. Now always derived from `contexto.equipeId` (the real session), never accepted from the client — same principle already applied throughout `nexaigen-educa`'s admin routes (never trust client-supplied identity when a real session exists to derive it from).

**The whole domain reduces to one pure function.** `lib/prazos.ts#diagnosticarNota()` takes a nota's current state (has it been atested? when? has it been paid?) plus "now", and returns both a derived status and, optionally, which alert to raise. It has no I/O and isn't aware of Supabase — this is deliberate, since it's the one piece of business logic worth unit-testing in isolation (`lib/prazos.test.ts`). If the escalation rules change, change the thresholds/logic here first, then trace outward to the cron job.

**Legal deadline is computed in the database, not just in application code.** `nota_fiscal.data_limite_pagamento` is set by a Postgres trigger (`trg_calcular_data_limite`) the moment `data_atesto` is written — `data_atesto + 30 days` (Lei 14.133/2021, Art. 141). This means the deadline can't be wrong even if a future code path writes `data_atesto` without going through the "official" update flow.

**`app/api/cron/verificar-prazos` is the only place that mutates alert/status state in bulk.** It's meant to run once a day (Vercel Cron, `vercel.json`), authenticated by comparing the `Authorization` header against `CRON_SECRET` with `crypto.timingSafeEqual` (constant-time on purpose — this endpoint is a bearer-token-guarded bulk-write path). It scans every open nota, re-derives status via `diagnosticarNota()`, and `upsert`s alerts with `ignoreDuplicates` — the partial unique index `uq_alerta_ativo` in `supabase/schema.sql` (one active alert per nota+tipo) is what actually guarantees idempotency; the `ignoreDuplicates` flag is a secondary guard, not the source of truth. Don't add a second code path that also writes `alerta_cobranca` without going through the same upsert pattern.

**Notification is a single channel by design**: `lib/notificacao-interna.ts` sends email via Resend (`RESEND_API_KEY`) when an `atraso_60_dias` alert fires — the internal alert to NEXAIGEN's own collections team (`COBRANCA_EMAIL_DESTINO`). It fails soft — if `RESEND_API_KEY` or `COBRANCA_EMAIL_DESTINO` is unset, it logs a warning and returns rather than throwing, so a missing env var never breaks the cron run. That also means a misconfigured environment sends zero notifications with no loud failure — check the Vercel/server logs, not just "did the job run". Body is HTML now (`lib/emailTemplate.ts#montarEmailHtml`, NEXAIGEN navy/teal identity — same visual identity as nexaigen-educa, deliberately, same company).

**`lib/notificacaoCliente.ts` — the client-facing counterpart, added in the "e-mails bonitos e cobrança automática" round.** Sends an email to the debtor prefeitura's own contact (`cliente_prefeitura.contato_email`, already existed in the schema) for all 4 `TipoAlerta` stages, not just `atraso_60_dias`. **Tone is the whole point of this feature**: copy escalates from neutral/helpful (`sem_atesto_prolongado`) to more serious-but-still-cordial (`atraso_60_dias`) — no stage ever contains a legal threat or affirmation ("vamos protestar", "medidas legais", etc.), since this goes out automatically, in the company's name, to an institutional client. Every client email is BCC'd (never a visible CC) to `COBRANCA_EMAIL_DESTINO` so the collections team has full visibility of what goes out automatically. **Fires only on state transition, never once per day while the state persists** — deliberately reuses `alerta_cobranca`'s existing `uq_alerta_ativo` partial unique index + the cron route's `ignoreDuplicates` upsert (a row is only returned when actually newly inserted) instead of adding a new tracking column — see the comment at the top of `lib/notificacaoCliente.ts` and in `app/api/cron/verificar-prazos/route.ts` for why that's sufficient.

**No portal credentials are ever stored.** `cliente_prefeitura.portal_usuario` is a login *name* only; there is deliberately no password column. Checking whether a prefeitura's portal shows a nota as atestada is a manual step (`app/checagem`) by design — see `README.md` for the reasoning and staffing math behind that choice. Don't add a password/secret field to this table without revisiting that decision explicitly.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
