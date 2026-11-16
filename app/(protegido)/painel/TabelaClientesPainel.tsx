"use client";

// Tabela de clientes do painel — Client Component só pela ordenação por
// atraso (clique no cabeçalho). Os dados já chegam prontos do Server
// Component (app/(protegido)/painel/page.tsx); a ordem usa a MESMA função
// pura do servidor (ordenarClientesPorAtraso). Sem dado de contato.
// Contrato encerrado continua aparecendo (rodada 12-A): a situação
// financeira vem das notas em aberto, que seguem sendo cobradas.

import { useState } from "react";
import { ROTULO_SITUACAO, formatarMoeda, ordenarClientesPorAtraso, type ClientePainel, type SituacaoCliente } from "@/lib/painelFinanceiro";
import { formatarDataBr } from "@/lib/cancelamentoContrato";
import SeloStatusContrato from "@/components/SeloStatusContrato";

const COR_SITUACAO: Record<SituacaoCliente, string> = {
  em_dia: "bg-emerald-50 text-emerald-700",
  atencao: "bg-amber-50 text-amber-700",
  inadimplente: "bg-red-50 text-alerta"
};

export default function TabelaClientesPainel({ clientes }: { clientes: ClientePainel[] }) {
  const [direcao, setDirecao] = useState<"desc" | "asc">("desc");
  const ordenados = ordenarClientesPorAtraso(clientes, direcao);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-navy">Clientes</h2>
        {clientes.length > 0 && (
          // Link real de download: a rota exige a mesma sessão (cookie vai junto, mesma origem).
          <a href="/api/painel-financeiro?formato=csv" download className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
            Exportar CSV
          </a>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-navy text-white">
            <tr>
              <th className="p-3 text-left">Prefeitura</th>
              <th className="p-3 text-left">Plano</th>
              <th className="p-3 text-right">Valor mensal</th>
              <th className="p-3 text-right">Notas em aberto</th>
              <th className="p-3 text-right">
                <button
                  onClick={() => setDirecao(direcao === "desc" ? "asc" : "desc")}
                  className="font-semibold hover:underline"
                  aria-label={`Ordenar por maior atraso, ${direcao === "desc" ? "crescente" : "decrescente"}`}
                >
                  Maior atraso {direcao === "desc" ? "▼" : "▲"}
                </button>
              </th>
              <th className="p-3 text-left">Situação</th>
            </tr>
          </thead>
          <tbody>
            {ordenados.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-3">
                  <a href={`/clientes?editar=${c.id}`} className="text-navy hover:underline">
                    {c.nome} — {c.uf}
                  </a>
                  {c.statusContrato !== "ativo" && (
                    <span className="ml-2">
                      <SeloStatusContrato status={c.statusContrato} />
                      {c.statusContrato === "em_aviso_previo" && c.terminoAvisoPrevio && (
                        <span className="ml-1 text-xs text-amber-800">término em {formatarDataBr(c.terminoAvisoPrevio)}</span>
                      )}
                    </span>
                  )}
                  {c.implantacaoACobrarCentavos !== null && (
                    <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Implantação a cobrar — {formatarMoeda(c.implantacaoACobrarCentavos)}
                    </span>
                  )}
                </td>
                <td className="p-3">{c.planoRotulo}</td>
                <td className="p-3 text-right">{formatarMoeda(c.valorMensalCentavos)}</td>
                <td className="p-3 text-right">
                  {c.notasEmAberto === 0 ? "—" : `${c.notasEmAberto} · ${formatarMoeda(c.valorEmAbertoCentavos)}`}
                </td>
                <td className="p-3 text-right">{c.maiorAtrasoDias === 0 ? "—" : `${c.maiorAtrasoDias} dias`}</td>
                <td className="p-3">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${COR_SITUACAO[c.situacao]}`}>{ROTULO_SITUACAO[c.situacao]}</span>
                </td>
              </tr>
            ))}
            {clientes.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-sm text-slate-400">
                  Nenhum cliente cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
