"use client";

// Tabela do relatório de novos contratos — Client Component só pela
// ordenação (clique no cabeçalho). Os dados chegam prontos do Server
// Component (./page.tsx). Sem dado de contato.

import { useState } from "react";
import SeloStatusContrato from "@/components/SeloStatusContrato";
import { formatarMoeda } from "@/lib/dinheiro";
import { ROTULO_ORIGEM, type ContratoNovo } from "@/lib/relatorioContratos";

type Coluna = "nome" | "uf" | "planoRotulo" | "valorMensalCentavos" | "taxaImplantacaoCentavos" | "dataInicio" | "statusContrato" | "origem";

const COLUNAS: { chave: Coluna; rotulo: string; numero?: boolean }[] = [
  { chave: "nome", rotulo: "Prefeitura" },
  { chave: "uf", rotulo: "UF" },
  { chave: "planoRotulo", rotulo: "Plano" },
  { chave: "valorMensalCentavos", rotulo: "Valor mensal", numero: true },
  { chave: "taxaImplantacaoCentavos", rotulo: "Taxa de implantação", numero: true },
  { chave: "dataInicio", rotulo: "Início (assinatura)" },
  { chave: "statusContrato", rotulo: "Status" },
  { chave: "origem", rotulo: "Origem" }
];

/** Ordena por uma coluna; nulos (sem taxa) sempre no fim. Exportada pra teste. */
export function ordenarContratos(contratos: ContratoNovo[], coluna: Coluna, direcao: "asc" | "desc"): ContratoNovo[] {
  const fator = direcao === "asc" ? 1 : -1;
  return [...contratos].sort((a, b) => {
    const va = a[coluna];
    const vb = b[coluna];
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
    return fator * cmp || a.nome.localeCompare(b.nome, "pt-BR");
  });
}

export default function TabelaNovosContratos({ contratos }: { contratos: ContratoNovo[] }) {
  const [ordem, setOrdem] = useState<{ coluna: Coluna; direcao: "asc" | "desc" }>({ coluna: "dataInicio", direcao: "asc" });
  const ordenados = ordenarContratos(contratos, ordem.coluna, ordem.direcao);

  function ordenarPor(coluna: Coluna) {
    setOrdem((o) => ({ coluna, direcao: o.coluna === coluna && o.direcao === "asc" ? "desc" : "asc" }));
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
      <table className="w-full text-sm" aria-label="Contratos novos do mês">
        <thead className="bg-navy text-white">
          <tr>
            {COLUNAS.map((c) => (
              <th key={c.chave} className={`p-3 ${c.numero ? "text-right" : "text-left"}`} aria-sort={ordem.coluna === c.chave ? (ordem.direcao === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => ordenarPor(c.chave)} className="font-semibold hover:underline">
                  {c.rotulo} {ordem.coluna === c.chave ? (ordem.direcao === "asc" ? "▲" : "▼") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordenados.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="p-3">{c.nome}</td>
              <td className="p-3">{c.uf}</td>
              <td className="p-3">{c.planoRotulo}</td>
              <td className="p-3 text-right">{formatarMoeda(c.valorMensalCentavos)}</td>
              <td className="p-3 text-right">{c.taxaImplantacaoCentavos === null ? "—" : formatarMoeda(c.taxaImplantacaoCentavos)}</td>
              <td className="p-3">{c.dataInicio.split("-").reverse().join("/")}</td>
              <td className="p-3">
                <SeloStatusContrato status={c.statusContrato} />
              </td>
              <td className="p-3">{ROTULO_ORIGEM[c.origem]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
