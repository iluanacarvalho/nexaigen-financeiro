async function getAlertas() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
  const res = await fetch(`${base}/api/alertas`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return data.alertas ?? [];
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
