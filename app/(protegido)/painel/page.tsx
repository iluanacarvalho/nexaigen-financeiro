// Painel financeiro gerencial (rodada 05) — Server Component lendo o
// repositório DIRETO (lib/painelFinanceiroRepositorio.ts), mesmo padrão do
// dashboard e de /alertas: self-fetch da própria API a partir de um
// Server Component não repassaria o cookie de sessão. A sessão já foi
// checada em app/(protegido)/layout.tsx. GET /api/painel-financeiro
// devolve exatamente os mesmos números (mesma função), e é de onde sai o CSV.
//
// Estado vazio honesto: KPI sem base aparece "—" (nunca um 0 fingindo
// dado) — quem decide o que é "sem base" é lib/painelFinanceiro.ts.

import { obterPainelFinanceiro } from "@/lib/painelFinanceiroRepositorio";
import { formatarMoeda, type PontoSerieMensal } from "@/lib/painelFinanceiro";
import TabelaClientesPainel from "./TabelaClientesPainel";

const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function rotuloMes(mes: string): string {
  return `${NOMES_MES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
}

function formatarNumero(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

export default async function PainelPage() {
  const painel = await obterPainelFinanceiro();
  const { kpis } = painel;
  const { contratos } = kpis.mrr;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-bold text-navy">Painel Financeiro</h1>
      <p className="mb-6 text-sm text-slate-500">
        Posição em {painel.hoje.split("-").reverse().join("/")} (horário de Brasília). Atrasos calculados pela data de hoje.
      </p>

      {painel.semNotas && (
        <p className="mb-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Ainda não há notas fiscais em aberto nem faturadas nos últimos 12 meses — os indicadores de faturamento e
          recebimento aparecem como “—” até a primeira nota ser cadastrada.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          titulo="Receita mensal recorrente (MRR)"
          valor={formatarMoeda(kpis.mrr.valorCentavos)}
          detalhe={`${contratos.ativos} ativos · ${contratos.suspensos} suspensos · ${contratos.encerrados} encerrados`}
        />
        <Card titulo={`Recebido em ${rotuloMes(painel.mesCorrente)}`} valor={formatarMoeda(kpis.recebidoMesCentavos)} />
        <Card titulo="A receber" valor={formatarMoeda(kpis.aReceber?.totalCentavos ?? null)}>
          {kpis.aReceber && (
            <dl className="mt-2 space-y-0.5 text-xs">
              <Linha rotulo="No prazo" valor={formatarMoeda(kpis.aReceber.noPrazoCentavos)} />
              <Linha rotulo="Vencidas" valor={formatarMoeda(kpis.aReceber.vencidasCentavos)} destaque={kpis.aReceber.vencidasCentavos > 0} />
              <Linha
                rotulo="Atraso crítico (≥60 dias)"
                valor={formatarMoeda(kpis.aReceber.atrasoCriticoCentavos)}
                destaque={kpis.aReceber.atrasoCriticoCentavos > 0}
              />
            </dl>
          )}
        </Card>
        <Card
          titulo="Inadimplência (12 meses)"
          valor={kpis.inadimplencia.percentual === null ? "—" : `${formatarNumero(kpis.inadimplencia.percentual)}%`}
          destaque={(kpis.inadimplencia.percentual ?? 0) > 0}
          detalhe={
            kpis.inadimplencia.percentual === null
              ? "Sem faturamento na janela"
              : `${formatarMoeda(kpis.inadimplencia.vencidoCentavos)} vencido de ${formatarMoeda(kpis.inadimplencia.faturadoCentavos)} faturado`
          }
        />
        <Card
          titulo="Prazo médio de recebimento"
          valor={kpis.prazoMedioRecebimentoDias === null ? "—" : `${formatarNumero(kpis.prazoMedioRecebimentoDias)} dias`}
          detalhe="Da emissão ao pagamento, notas pagas nos últimos 12 meses"
        />
        <Card
          titulo="Aguardando atesto há mais de 15 dias"
          valor={kpis.aguardandoAtestoMais15Dias === null ? "—" : String(kpis.aguardandoAtestoMais15Dias)}
          destaque={(kpis.aguardandoAtestoMais15Dias ?? 0) > 0}
          detalhe="Notas sem atesto registrado — ver Fila de Checagem"
        />
      </div>

      <section aria-label="Implantação (única)" className="mt-4 rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-navy">Implantação (única)</h2>
        <p className="mb-3 text-xs text-slate-500">
          Taxa de implantação e treinamento — cobrada uma vez, fora da mensalidade: não entra no MRR, mas entra em &quot;recebido&quot;, &quot;a receber&quot; e
          inadimplência acima.
        </p>
        {kpis.implantacao.aCobrar.clientes === 0 && kpis.implantacao.aReceberCentavos === 0 && kpis.implantacao.recebidaCentavos === 0 ? (
          // Estado vazio honesto: sem nada de implantação, uma frase — nunca três "R$ 0,00" fingindo dado.
          <p className="text-sm text-slate-500">Nenhuma taxa de implantação a cobrar, em aberto ou recebida nos últimos 12 meses.</p>
        ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">A cobrar (sem nota emitida)</dt>
              <dd className={`text-xl font-bold ${kpis.implantacao.aCobrar.clientes > 0 ? "text-amber-700" : "text-navy"}`}>{formatarMoeda(kpis.implantacao.aCobrar.centavos)}</dd>
              <dd className="text-xs text-slate-400">
                {kpis.implantacao.aCobrar.clientes} {kpis.implantacao.aCobrar.clientes === 1 ? "cliente" : "clientes"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">A receber (nota emitida, em aberto)</dt>
              <dd className="text-xl font-bold text-navy">{formatarMoeda(kpis.implantacao.aReceberCentavos)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Recebida (últimos 12 meses)</dt>
              <dd className="text-xl font-bold text-navy">{formatarMoeda(kpis.implantacao.recebidaCentavos)}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="mt-8 rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-navy">Faturado x recebido — últimos 12 meses</h2>
        <p className="mb-4 text-xs text-slate-500">
          Faturado pela competência da nota; recebido pelo mês em que o pagamento foi registrado.
        </p>
        <GraficoSerie serie={painel.serie} />
      </section>

      <section className="mt-8">
        <TabelaClientesPainel clientes={painel.clientes} />
      </section>
    </main>
  );
}

function Card({
  titulo,
  valor,
  detalhe,
  destaque = false,
  children
}: {
  titulo: string;
  valor: string;
  detalhe?: string;
  destaque?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border bg-white p-5 shadow-sm ${destaque ? "border-alerta" : ""}`}>
      <p className="text-sm text-slate-500">{titulo}</p>
      <p className={`mt-1 text-2xl font-bold ${destaque ? "text-alerta" : "text-navy"}`}>{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-slate-400">{detalhe}</p>}
      {children}
    </div>
  );
}

function Linha({ rotulo, valor, destaque = false }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{rotulo}</dt>
      <dd className={destaque ? "font-semibold text-alerta" : "text-slate-700"}>{valor}</dd>
    </div>
  );
}

// Gráfico de barras agrupadas em SVG puro (sem biblioteca). Escala pelo
// maior valor da janela; sem nenhum valor, não desenha um gráfico de
// barras zeradas — diz que não há dado.
function GraficoSerie({ serie }: { serie: PontoSerieMensal[] }) {
  const maximo = Math.max(...serie.map((p) => Math.max(p.faturadoCentavos, p.recebidoCentavos)));
  if (maximo === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">Sem faturamento nem recebimento nos últimos 12 meses.</p>;
  }

  const largura = 720;
  const altura = 220;
  const margemBase = 24;
  const alturaUtil = altura - margemBase - 8;
  const larguraGrupo = largura / serie.length;
  const larguraBarra = larguraGrupo * 0.32;

  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-navy" /> Faturado
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-teal" /> Recebido
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${largura} ${altura}`} className="h-56 w-full min-w-[560px]" role="img" aria-label="Faturado e recebido por mês">
          <line x1={0} x2={largura} y1={altura - margemBase} y2={altura - margemBase} stroke="#cbd5e1" />
          {serie.map((p, i) => {
            const x = i * larguraGrupo + larguraGrupo * 0.16;
            const hF = (p.faturadoCentavos / maximo) * alturaUtil;
            const hR = (p.recebidoCentavos / maximo) * alturaUtil;
            const base = altura - margemBase;
            return (
              <g key={p.mes}>
                <rect x={x} y={base - hF} width={larguraBarra} height={hF} fill="#1F3864" rx={2}>
                  <title>{`${rotuloMes(p.mes)} — faturado ${formatarMoeda(p.faturadoCentavos)}`}</title>
                </rect>
                <rect x={x + larguraBarra + 2} y={base - hR} width={larguraBarra} height={hR} fill="#2E75B6" rx={2}>
                  <title>{`${rotuloMes(p.mes)} — recebido ${formatarMoeda(p.recebidoCentavos)}`}</title>
                </rect>
                <text x={i * larguraGrupo + larguraGrupo / 2} y={altura - 6} textAnchor="middle" fontSize={11} fill="#64748b">
                  {rotuloMes(p.mes)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
