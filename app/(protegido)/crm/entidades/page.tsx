// Entidades intermunicipais (rodada 16-A2): associações de municípios,
// consórcios etc., com quantas prefeituras de cada uma já são clientes, estão
// em negociação ou ainda não foram abordadas (mesma função de status do
// Território). Entidade com cliente fica destacada. Área "crm" (layout).

import Link from "next/link";
import { redirect } from "next/navigation";
import { contextoDaPagina } from "@/lib/authPagina";
import { escopoDe } from "@/lib/crmHttp";
import { ROTULO_TIPO_ENTIDADE } from "@/lib/entidades";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { listarEntidades } from "@/lib/territorioRepositorio";

const pct = (v: number | null) => (v === null ? "—" : `${String(v).replace(".", ",")}%`);

export default async function EntidadesPage({ searchParams }: { searchParams: Promise<{ busca?: string | string[] }> }) {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  const leitor = escopoDe(contexto);
  const { busca: buscaBruta } = await searchParams;
  const busca = typeof buscaBruta === "string" ? buscaBruta.trim().slice(0, 60) : "";
  const entidades = await listarEntidades(leitor, hojeEmSaoPaulo(new Date()), busca || undefined);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-navy">Entidades — associações e consórcios</h1>
        {leitor.admin && (
          <Link href="/crm/entidades/nova" className="rounded bg-navy px-4 py-2 text-sm text-white">
            + Nova entidade
          </Link>
        )}
      </div>
      <form role="search" aria-label="Buscar entidade" className="mb-4 flex gap-2 text-sm">
        <label className="sr-only" htmlFor="busca-entidade">
          Nome ou sigla
        </label>
        <input id="busca-entidade" name="busca" defaultValue={busca} maxLength={60} placeholder="Nome ou sigla" className="w-72 max-w-full rounded border border-slate-300 px-3 py-1.5" />
        <button type="submit" className="rounded bg-navy px-3 py-1.5 text-white">
          Buscar
        </button>
      </form>
      {entidades.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-slate-600">
          {busca ? (
            <p>Nenhuma entidade com &quot;{busca}&quot;.</p>
          ) : (
            <>
              <p className="font-medium">Nenhuma entidade cadastrada ainda.</p>
              <p className="mt-1">As associações e consórcios entram pelo cadastro {leitor.admin ? "(botão acima)" : "do administrador"} ou por planilha CSV (modelo em docs/modelos/entidades-modelo.csv).</p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <caption className="sr-only">Entidades com a situação comercial dos municípios membros</caption>
            <thead className="bg-navy text-white">
              <tr>
                <th scope="col" className="p-2 text-left">Entidade</th>
                <th scope="col" className="p-2 text-left">Tipo</th>
                <th scope="col" className="p-2 text-right">Municípios</th>
                <th scope="col" className="p-2 text-right">Clientes</th>
                <th scope="col" className="p-2 text-right">Em negociação</th>
                <th scope="col" className="p-2 text-right">Não abordados</th>
                <th scope="col" className="p-2 text-right">% clientes</th>
              </tr>
            </thead>
            <tbody>
              {entidades.map((e) => (
                <tr key={e.id} className={`border-t ${e.clientes > 0 ? "bg-emerald-50" : ""}`} data-testid={`entidade-${e.id}`}>
                  <td className="p-2">
                    <Link href={`/crm/entidades/${e.id}`} className="font-medium text-navy underline">
                      {e.sigla ? `${e.sigla} — ` : ""}
                      {e.nome}
                    </Link>
                    {e.uf && <span className="ml-1 text-xs text-slate-500">({e.uf})</span>}
                    {e.clientes > 0 && <span className="ml-2 rounded bg-emerald-200 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-900">tem cliente</span>}
                    {!e.ativo && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-700">desativada</span>}
                  </td>
                  <td className="p-2">{ROTULO_TIPO_ENTIDADE[e.tipo]}</td>
                  <td className="p-2 text-right">{e.municipios}</td>
                  <td className="p-2 text-right font-semibold">{e.clientes}</td>
                  <td className="p-2 text-right">{e.em_negociacao}</td>
                  <td className="p-2 text-right">{e.nao_abordados}</td>
                  <td className="p-2 text-right">{pct(e.percentual_clientes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
