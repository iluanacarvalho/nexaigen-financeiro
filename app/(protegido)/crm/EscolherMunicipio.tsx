"use client";

// Escolher o município NA BASE territorial (rodada 16-A3) — cadastro e
// edição de lead em estado LIBERADO, e "Vincular ao município" de lead
// antigo. Busca por nome (ou código) na UF (GET /api/municipios); escolhido,
// o município fica TRAVADO (nome, UF, código IBGE e população vêm da base)
// com "Trocar município".

import { useEffect, useState } from "react";

export interface MunicipioEscolhido {
  codigo_ibge: string;
  nome: string;
  uf: string;
  populacao: number | null;
}

export default function EscolherMunicipio({
  uf,
  escolhido,
  onEscolher,
  rotulo = "Município"
}: {
  uf: string;
  escolhido: MunicipioEscolhido | null;
  onEscolher: (m: MunicipioEscolhido | null) => void;
  rotulo?: string;
}) {
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<{ termo: string; lista: MunicipioEscolhido[] } | null>(null);

  useEffect(() => {
    const termo = busca.trim();
    if (escolhido || termo.length < 2) return;
    let ativo = true;
    const espera = setTimeout(async () => {
      const res = await fetch(`/api/municipios?busca=${encodeURIComponent(termo)}&uf=${uf}`);
      if (ativo && res.ok) setAchados({ termo, lista: (await res.json()).municipios });
    }, 250);
    return () => {
      ativo = false;
      clearTimeout(espera);
    };
  }, [busca, uf, escolhido]);

  if (escolhido) {
    return (
      <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2" data-testid="municipio-escolhido">
        <span className="block font-medium text-slate-700">{rotulo}</span>
        <span className="font-semibold text-slate-900">
          {escolhido.nome} — {escolhido.uf}
        </span>
        <span className="block text-xs text-slate-600">
          Código IBGE {escolhido.codigo_ibge} · {escolhido.populacao === null ? "população não informada" : `${escolhido.populacao.toLocaleString("pt-BR")} hab.`} (dados da base)
        </span>
        <button
          type="button"
          onClick={() => {
            setBusca("");
            setAchados(null);
            onEscolher(null);
          }}
          className="mt-1 text-xs text-navy underline"
        >
          Trocar município
        </button>
      </div>
    );
  }

  const lista = achados && achados.termo === busca.trim() ? achados.lista : null;
  return (
    <div>
      <label className="block">
        <span className="font-medium text-slate-700">{rotulo} (busque na base de {uf})</span>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite o nome do município" maxLength={60} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
      </label>
      {busca.trim().length >= 2 && lista && (
        <ul aria-label="Municípios da base" className="mt-1 max-h-48 overflow-y-auto rounded border bg-white">
          {lista.length === 0 && <li className="px-2 py-1 text-slate-500">Nenhum município de {uf} com esse nome.</li>}
          {lista.map((m) => (
            <li key={m.codigo_ibge}>
              <button type="button" onClick={() => onEscolher(m)} className="block w-full px-2 py-1 text-left hover:bg-slate-100">
                {m.nome} — {m.uf} <span className="text-xs text-slate-500">({m.populacao === null ? "sem população" : `${m.populacao.toLocaleString("pt-BR")} hab.`})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
