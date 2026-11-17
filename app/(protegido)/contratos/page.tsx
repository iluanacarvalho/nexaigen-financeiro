// Relatório "Novos contratos" por mês (rodada 15-A) — Server Component
// lendo o repositório DIRETO (mesmo padrão do Painel: self-fetch da
// própria API não repassaria o cookie de sessão). Acesso: área "contratos"
// (admin e financeiro), checado no layout.tsx desta pasta; a API de
// exportação checa de novo. Números e exportação vêm da MESMA função
// (lib/relatorioContratos.ts) — GET /api/relatorios/novos-contratos
// devolve exatamente isto em JSON/CSV/XLSX.
//
// REGRA: a vigência começa na ASSINATURA — "novo no mês" =
// data_inicio_contrato (data de assinatura) dentro do mês. Estado vazio
// honesto: mês sem contrato novo diz isso, nunca mostra zeros fingindo dado.

import { formatarMoeda } from "@/lib/dinheiro";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { rotuloMes, validarMes, type PontoSerieContratos } from "@/lib/relatorioContratos";
import { obterRelatorioContratos } from "@/lib/relatorioContratosRepositorio";
import { textoVariacao } from "@/lib/relatorioContratosExportacao";
import TabelaNovosContratos from "./TabelaNovosContratos";

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

export default async function ContratosPage({ searchParams }: { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> }) {
  const agora = new Date();
  const mesAtual = hojeEmSaoPaulo(agora).slice(0, 7);
  const pedido = (await searchParams).mes;
  const mesPedido = typeof pedido === "string" ? pedido : undefined;
  const erroMes = mesPedido === undefined ? null : validarMes(mesPedido, mesAtual);
  const mes = mesPedido !== undefined && erroMes === null ? mesPedido : mesAtual;
  const r = await obterRelatorioContratos(mes, agora);
  const exportar = (formato: "csv" | "xlsx") => `/api/relatorios/novos-contratos?mes=${mes}&formato=${formato}`;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-bold text-navy">Novos contratos</h1>
      <p className="mb-6 text-sm text-slate-500">
        A vigência começa na assinatura: conta como novo no mês o contrato cuja data de início (assinatura) cai no mês. Valores mensais combinados atuais.
      </p>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 text-sm" aria-label="Escolher mês">
        <label className="block">
          <span className="font-medium text-slate-700">Mês</span>
          <input type="month" name="mes" defaultValue={mes} min="2000-01" max={mesAtual} className="mt-1 block rounded border border-slate-300 px-2 py-1" />
        </label>
        <button type="submit" className="rounded bg-navy px-3 py-1.5 text-white">
          Ver
        </button>
        <span className="ml-auto flex gap-3">
          <a href={exportar("csv")} download className="text-navy underline">
            Exportar CSV
          </a>
          <a href={exportar("xlsx")} download className="text-navy underline">
            Exportar XLSX
          </a>
        </span>
      </form>
      {erroMes && (
        <p role="alert" className="mb-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {erroMes} Mostrando o mês atual ({rotuloMes(mesAtual)}).
        </p>
      )}

      <h2 className="mb-3 font-semibold text-navy">{rotuloMes(r.mes)}</h2>
      {r.semContratos && <p className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">Nenhum contrato novo neste mês.</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          titulo="Novos contratos"
          valor={r.semContratos ? "—" : String(r.novos.quantidade)}
          detalhe={`${rotuloMes(r.mesAnterior)}: ${r.anterior.quantidade} · variação ${textoVariacao(r.variacao.quantidade)}`}
        />
        <Card
          titulo="MRR novo"
          valor={r.semContratos ? "—" : formatarMoeda(r.novos.mrrCentavos)}
          detalhe={`${rotuloMes(r.mesAnterior)}: ${formatarMoeda(r.anterior.mrrCentavos)} · variação ${textoVariacao(r.variacao.mrr, (n) => formatarMoeda(n))}`}
        />
        <Card
          titulo="Implantação a cobrar dos novos"
          valor={r.semContratos ? "—" : formatarMoeda(r.novos.implantacaoACobrarCentavos)}
          detalhe="Taxas combinadas ainda sem nota de implantação"
        />
        <Card titulo="Contratos encerrados no mês" valor={String(r.encerrados.quantidade)} detalhe={`MRR que saiu: ${formatarMoeda(r.encerrados.mrrCentavos)}`} />
        <Card
          titulo="Em aviso prévio"
          valor={String(r.emAvisoPrevio.quantidade)}
          detalhe={`Em ${dataBr(r.dataReferencia)} · MRR em risco: ${formatarMoeda(r.emAvisoPrevio.mrrCentavos)}`}
        />
        <Card
          titulo="Saldo líquido (novos − encerrados)"
          valor={`${r.saldoLiquido.quantidade > 0 ? "+" : ""}${r.saldoLiquido.quantidade}`}
          detalhe={`MRR líquido: ${formatarMoeda(r.saldoLiquido.mrrCentavos)} · MRR da carteira hoje: ${formatarMoeda(r.mrrCarteiraHojeCentavos)} (mesma conta do Painel)`}
        />
      </div>

      <section className="mt-8 rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-navy">Últimos 12 meses</h2>
        <p className="mb-4 text-xs text-slate-500">Barras: novos contratos por mês. Linha: MRR novo acumulado desde o primeiro mês da janela.</p>
        <GraficoSerie serie={r.serie} />
      </section>

      {!r.semContratos && (
        <section className="mt-8">
          <TabelaNovosContratos contratos={r.contratos} />
        </section>
      )}
    </main>
  );
}

function Card({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe: string }) {
  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{titulo}</p>
      <p className="mt-1 text-2xl font-bold text-navy">{valor}</p>
      <p className="mt-1 text-xs text-slate-400">{detalhe}</p>
    </div>
  );
}

const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// SVG puro (sem biblioteca): barras = quantidade; linha = MRR novo acumulado (escala própria).
function GraficoSerie({ serie }: { serie: PontoSerieContratos[] }) {
  const maxNovos = Math.max(...serie.map((p) => p.novos));
  const maxMrr = Math.max(...serie.map((p) => p.mrrNovoAcumuladoCentavos));
  if (maxNovos === 0) return <p className="py-8 text-center text-sm text-slate-400">Nenhum contrato novo nos últimos 12 meses.</p>;

  const largura = 720;
  const altura = 220;
  const base = altura - 24;
  const util = base - 12;
  const passo = largura / serie.length;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${largura} ${altura}`} className="h-56 w-full min-w-[560px]" role="img" aria-label="Novos contratos e MRR novo acumulado por mês">
        <line x1={0} x2={largura} y1={base} y2={base} stroke="#cbd5e1" />
        {serie.map((p, i) => {
          const h = (p.novos / maxNovos) * util;
          const x = i * passo + passo * 0.25;
          return (
            <g key={p.mes}>
              <rect x={x} y={base - h} width={passo * 0.5} height={h} fill="#1F3864" rx={2}>
                <title>{`${rotuloMes(p.mes)}: ${p.novos} novo(s), MRR novo ${formatarMoeda(p.mrrNovoCentavos)}`}</title>
              </rect>
              {p.novos > 0 && (
                <text x={x + passo * 0.25} y={base - h - 3} textAnchor="middle" fontSize={11} fill="#1F3864">
                  {p.novos}
                </text>
              )}
              <text x={x + passo * 0.25} y={altura - 6} textAnchor="middle" fontSize={11} fill="#64748b">
                {`${NOMES_MES[Number(p.mes.slice(5, 7)) - 1]}/${p.mes.slice(2, 4)}`}
              </text>
            </g>
          );
        })}
        {maxMrr > 0 && (
          <polyline
            fill="none"
            stroke="#14b8a6"
            strokeWidth={2}
            points={serie.map((p, i) => `${i * passo + passo / 2},${base - (p.mrrNovoAcumuladoCentavos / maxMrr) * util}`).join(" ")}
          />
        )}
      </svg>
      <p className="mt-2 text-xs text-slate-500">MRR novo acumulado na janela: {formatarMoeda(serie[serie.length - 1].mrrNovoAcumuladoCentavos)}</p>
    </div>
  );
}
