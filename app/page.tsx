import { supabaseServer } from "@/lib/supabase/server";

export default async function Dashboard() {
  const supabase = supabaseServer();
  const { data: notas } = await supabase.from("nota_fiscal").select("status, valor");
  const { data: alertas } = await supabase.from("alerta_cobranca").select("tipo").neq("status", "resolvido");

  const contagem: Record<string, number> = {};
  let valorEmAberto = 0;
  for (const n of notas ?? []) {
    contagem[n.status] = (contagem[n.status] ?? 0) + 1;
    if (n.status !== "paga" && n.status !== "cancelada") valorEmAberto += Number(n.valor);
  }

  const alertasCriticos = (alertas ?? []).filter((a) => a.tipo === "atraso_60_dias").length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold text-navy">Dashboard Financeiro</h1>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card titulo="Aguardando atesto" valor={contagem["aguardando_atesto"] ?? 0} />
        <Card titulo="Atestadas (aguardando pagamento)" valor={contagem["atestada"] ?? 0} />
        <Card titulo="Vencidas" valor={contagem["vencida"] ?? 0} destaque />
        <Card titulo="Atraso crítico (≥60 dias)" valor={contagem["atraso_critico"] ?? 0} destaque />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Valor total em aberto</p>
          <p className="mt-1 text-3xl font-bold text-navy">
            {valorEmAberto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Alertas de cobrança ativos (atraso ≥60 dias)</p>
          <p className="mt-1 text-3xl font-bold text-alerta">{alertasCriticos}</p>
        </div>
      </div>

      <p className="mt-8 text-xs text-slate-400">
        Status recalculado automaticamente pelo job diário (/api/cron/verificar-prazos). Ver README para agendar no
        Vercel Cron.
      </p>
    </main>
  );
}

function Card({ titulo, valor, destaque = false }: { titulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`rounded-lg border bg-white p-5 shadow-sm ${destaque && valor > 0 ? "border-alerta" : ""}`}>
      <p className="text-sm text-slate-500">{titulo}</p>
      <p className={`mt-1 text-3xl font-bold ${destaque && valor > 0 ? "text-alerta" : "text-navy"}`}>{valor}</p>
    </div>
  );
}
