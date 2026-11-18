// Estados comerciais (rodada 16-A2) — só admin (layout). Vendas só vê no
// Território os estados LIBERADOS. Em produção, liberar é SEMPRE por aqui.
// Estado sem base de municípios carregada não pode ser liberado (nada pra mostrar).

import { listarEstados } from "@/lib/territorioRepositorio";
import BotaoEstado from "./BotaoEstado";

export default async function EstadosPage() {
  const estados = await listarEstados();
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-navy">Estados do comercial</h1>
      <p className="mb-4 text-sm text-slate-600">Vendas só enxerga no Território os estados liberados. Para carregar a base de um estado novo: npm run gerar-base-municipios -- UF (com revisão do arquivo) e npm run importar-municipios -- UF.</p>
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <caption className="sr-only">Estados e situação comercial</caption>
          <thead className="bg-navy text-white">
            <tr>
              <th scope="col" className="p-2 text-left">UF</th>
              <th scope="col" className="p-2 text-right">Municípios na base</th>
              <th scope="col" className="p-2 text-left">Situação</th>
              <th scope="col" className="p-2 text-left">Ação</th>
            </tr>
          </thead>
          <tbody>
            {estados.map((e) => (
              <tr key={e.uf} className="border-t" data-testid={`estado-${e.uf}`}>
                <td className="p-2 font-medium">{e.uf}</td>
                <td className="p-2 text-right">{e.municipios || "—"}</td>
                <td className="p-2">
                  {e.liberado ? (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                      Liberado{e.liberado_em ? ` em ${new Date(e.liberado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}
                      {e.liberado_por_nome ? ` por ${e.liberado_por_nome}` : ""}
                    </span>
                  ) : (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Bloqueado</span>
                  )}
                </td>
                <td className="p-2">
                  <BotaoEstado uf={e.uf} liberado={e.liberado} semBase={e.municipios === 0} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
