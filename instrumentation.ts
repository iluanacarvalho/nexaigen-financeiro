// Hook de observabilidade padrão do Next.js (App Router, estável desde a
// v15, ver node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md)
// — `onRequestError` captura toda falha não tratada do lado do SERVIDOR
// (Server Components, Route Handlers, Server Actions) ANTES dela virar só
// uma página de erro genérica ou uma linha de log que ninguém está
// olhando naquele momento. Este projeto não tinha NENHUM mecanismo de
// alerta pra falha TÉCNICA até esta rodada — só os dois alertas de
// NEGÓCIO (lib/notificacao-interna.ts, lib/notificacaoCliente.ts). Esta é
// a categoria "excecao_nao_tratada" de lib/alertaErroSistema.ts — o
// "catch-all" pra qualquer falha que não passou por um dos pontos de
// alerta já instrumentados manualmente (lib/armazenamentoObjetos.ts, os
// dois módulos de notificação, o job de cron).
//
// GUARD NEXT_RUNTIME === "nodejs": lib/alertaErroSistema.ts importa
// lib/db.ts ("pg") e "resend" — nenhum dos dois funciona no runtime Edge.
// Este projeto não tem middleware/proxy.ts hoje, mas instrumentation.ts é
// compilado pra ambos os runtimes pelo Next (o mesmo arquivo serve de
// entrada pros dois bundles) — sem este guard, uma eventual mudança
// futura (ex.: adicionar um middleware) poderia tentar rodar este código
// em Edge e falhar ao resolver "pg". O import de lib/alertaErroSistema.ts
// é DINÂMICO (await import(...)) e só acontece DEPOIS do guard, de
// propósito — evita que o bundler precise sequer resolver "pg"/"resend"
// pro bundle Edge, não só pular a chamada em runtime.
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const mensagem = err instanceof Error ? err.message : String(err);
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;

  const { alertarErroSistema } = await import("./lib/alertaErroSistema");
  await alertarErroSistema(
    "excecao_nao_tratada",
    `${request.method} ${request.path} (${context.routerKind}, ${context.routeType}) — ${mensagem}${digest ? ` [digest: ${digest}]` : ""}`
  );
};
