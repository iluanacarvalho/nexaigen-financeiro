// Consulta o banco DIRETO (não self-fetch da própria /api/alertas) —
// decisão de uma rodada anterior (correção de achado crítico de
// segurança): um Server Component fazendo self-fetch pra própria API não
// repassa o cookie de sessão automaticamente, o que quebraria assim que
// aquela rota passou a exigir sessão. Postgres direto via lib/db.ts desde
// a rodada de migração de infraestrutura (Supabase → pg) — mesma query
// (com o mesmo JOIN triplo) de app/api/alertas/route.ts, ver o comentário
// completo lá sobre o `json_build_object` aninhado.

import { query } from "@/lib/db";

async function getAlertas() {
  return query(
    `select
       a.*,
       json_build_object(
         'numero_nf', nf.numero_nf,
         'valor', nf.valor,
         'data_limite_pagamento', nf.data_limite_pagamento,
         'cliente', json_build_object('nome', c.nome, 'uf', c.uf, 'contato_email', c.contato_email, 'contato_telefone', c.contato_telefone)
       ) as nota
     from alerta_cobranca a
     join nota_fiscal nf on nf.id = a.nota_fiscal_id
     join cliente_prefeitura c on c.id = nf.cliente_id
     where a.status <> 'resolvido'
     order by a.gerado_em desc`
  );
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
