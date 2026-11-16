// Dashboard — números da MESMA fonte do Painel e de GET
// /api/painel-financeiro (lib/resumoDashboard.ts): situação derivada pela
// data de hoje e centavos inteiros, nunca a coluna status gravada nem
// soma em ponto flutuante. A checagem de sessão já roda em
// app/(protegido)/layout.tsx, antes desta página renderizar.

import { formatarMoeda } from "@/lib/dinheiro";
import { obterResumoDashboard } from "@/lib/resumoDashboard";
import { avisosDeConfiguracao, lerStatusConfiguracao } from "@/lib/statusConfiguracao";

export default async function Dashboard() {
  const resumo = await obterResumoDashboard();
  const contagem = resumo.contagemPorSituacao;
  // Só booleanos do ambiente (nunca valores) — ver lib/statusConfiguracao.ts.
  const avisosConfiguracao = avisosDeConfiguracao(lerStatusConfiguracao());

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold text-navy">Dashboard Financeiro</h1>

      {avisosConfiguracao.length > 0 && (
        <section role="alert" className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Configuração incompleta — algumas funções não vão funcionar:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {avisosConfiguracao.map((aviso) => (
              <li key={aviso}>{aviso}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">Peça a quem administra o servidor para preencher essas variáveis (ver .env.example).</p>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Card titulo="Aguardando atesto" valor={contagem?.aguardando_atesto ?? null} />
        <Card titulo="Atestadas (no prazo)" valor={contagem?.atestada ?? null} />
        <Card titulo="Vencidas" valor={contagem?.vencida ?? null} destaque />
        <Card titulo="Atraso crítico (≥60 dias)" valor={contagem?.atraso_critico ?? null} destaque />
      </div>

      {resumo.semNotas && (
        <p className="mt-4 text-sm text-slate-500">Nenhuma nota fiscal ainda — os números aparecem assim que a primeira for lançada em Notas fiscais.</p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Valor total em aberto</p>
          <p className="mt-1 text-3xl font-bold text-navy">
            {formatarMoeda(resumo.emAbertoCentavos)}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Alertas de cobrança ativos (atraso ≥60 dias)</p>
          <p className="mt-1 text-3xl font-bold text-alerta">{resumo.alertasCriticosAtivos}</p>
        </div>
      </div>

      {resumo.implantacaoACobrar.clientes > 0 && (
        <a href="/notas" className="mt-4 block rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm shadow-sm hover:bg-amber-100">
          <p className="font-semibold text-amber-900">
            Implantação a cobrar: {resumo.implantacaoACobrar.clientes} {resumo.implantacaoACobrar.clientes === 1 ? "cliente" : "clientes"} —{" "}
            {formatarMoeda(resumo.implantacaoACobrar.centavos)}
          </p>
          <p className="mt-1 text-xs text-amber-800">Taxas de implantação combinadas ainda sem nota emitida. Crie a nota em Notas fiscais quando puder ser cobrada.</p>
        </a>
      )}

      <p className="mt-8 text-xs text-slate-400">
        Status recalculado automaticamente pelo job diário (/api/cron/verificar-prazos), agendado pelo GitHub Actions
        — ver README, Seção 5.
      </p>
    </main>
  );
}

// valor null = banco sem notas: "—", nunca um 0 fingindo dado (mesma regra do Painel).
function Card({ titulo, valor, destaque = false }: { titulo: string; valor: number | null; destaque?: boolean }) {
  const realce = destaque && (valor ?? 0) > 0;
  return (
    <div className={`rounded-lg border bg-white p-5 shadow-sm ${realce ? "border-alerta" : ""}`}>
      <p className="text-sm text-slate-500">{titulo}</p>
      <p className={`mt-1 text-3xl font-bold ${realce ? "text-alerta" : "text-navy"}`}>{valor ?? "—"}</p>
    </div>
  );
}
