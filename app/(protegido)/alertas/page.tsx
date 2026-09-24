// Rodada de correção de achado crítico de segurança — ACHADO ADICIONAL
// nesta página específica: getAlertas() fazia self-fetch pra própria
// /api/alertas (fetch(`${base}/api/alertas`)) SEM encaminhar o cookie de
// sessão — depois que aquela rota passou a exigir exigirSessao(), esse
// self-fetch sempre devolveria 401 (Server Components não repassam
// cookies automaticamente pra uma URL absoluta, mesmo achado já
// documentado no CLAUDE.md do projeto irmão nexaigen-educa). Em vez de
// remontar o header Cookie manualmente, esta página passou a consultar
// supabaseAdmin() DIRETO — mesmo padrão que app/(protegido)/page.tsx
// (dashboard) já usava — evitando o problema por completo em vez de só
// contorná-lo. A checagem de sessão de verdade continua sendo o layout
// do grupo protegido (app/(protegido)/layout.tsx), que já rodou antes
// desta página renderizar.

import { supabaseAdmin } from "@/lib/supabase/server";

async function getAlertas() {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from("alerta_cobranca")
    .select(
      "*, nota:nota_fiscal_id ( numero_nf, valor, data_limite_pagamento, cliente:cliente_id ( nome, uf, contato_email, contato_telefone ) )"
    )
    .neq("status", "resolvido")
    .order("gerado_em", { ascending: false });
  return data ?? [];
}

const LABEL_TIPO: Record<string, string> = {
  sem_atesto_prolongado: "Sem atesto há muito tempo",
  proximo_vencimento: "Vencendo em breve",
  vencido: "Vencido",
  atraso_60_dias: "Atraso crítico (≥60 dias) — acionar cobrança"
};

export default async function AlertasPage() {
  const alertas = await getAlertas();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold text-navy">Alertas de Cobrança</h1>

      <div className="space-y-3">
        {alertas.map((a: any) => (
          <div
            key={a.id}
            className={`rounded-lg border bg-white p-4 shadow-sm ${a.tipo === "atraso_60_dias" ? "border-alerta" : ""}`}
          >
            <p className={`text-sm font-semibold ${a.tipo === "atraso_60_dias" ? "text-alerta" : "text-navy"}`}>
              {LABEL_TIPO[a.tipo] ?? a.tipo}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {a.nota?.cliente?.nome} — {a.nota?.cliente?.uf} · NF {a.nota?.numero_nf ?? "—"} ·{" "}
              {Number(a.nota?.valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Contato: {a.nota?.cliente?.contato_email ?? "—"} · {a.nota?.cliente?.contato_telefone ?? "—"}
            </p>
          </div>
        ))}
        {alertas.length === 0 && (
          <p className="rounded-lg border bg-white p-6 text-center text-sm text-slate-400">Nenhum alerta ativo.</p>
        )}
      </div>
    </main>
  );
}
