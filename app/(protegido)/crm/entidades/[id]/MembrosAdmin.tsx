"use client";

// Admin: adicionar/remover membros da entidade (rodada 16-A2) — busca de
// município por nome ou código (GET /api/municipios).

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Municipio {
  codigo_ibge: string;
  nome: string;
  uf: string;
}

export default function MembrosAdmin({ entidadeId, membros }: { entidadeId: string; membros: Municipio[] }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Municipio[] | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setMensagem(null);
    const res = await fetch(`/api/municipios?busca=${encodeURIComponent(busca.trim())}`);
    const corpo = await res.json().catch(() => null);
    if (!res.ok) setMensagem(corpo?.detalhes?.fieldErrors?.busca?.[0] ?? corpo?.erro ?? "Busca inválida.");
    else setAchados(corpo.municipios);
  }

  async function alterar(metodo: "POST" | "DELETE", m: Municipio) {
    setMensagem(null);
    const res = await fetch(`/api/entidades/${entidadeId}/membros`, { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify({ codigo_ibge: m.codigo_ibge }) });
    const corpo = await res.json().catch(() => null);
    setMensagem(res.ok ? `${m.nome} ${metodo === "POST" ? "adicionado" : "removido"}.` : (corpo?.erro ?? "Não foi possível alterar."));
    if (res.ok) router.refresh();
  }

  const codigos = new Set(membros.map((m) => m.codigo_ibge));
  return (
    <details className="mt-4 rounded-lg border bg-white p-3 text-sm">
      <summary className="cursor-pointer font-semibold text-navy">Gerenciar membros ({membros.length})</summary>
      <form onSubmit={buscar} className="mt-2 flex gap-2">
        <label className="sr-only" htmlFor="busca-membro">
          Município (nome ou código IBGE)
        </label>
        <input id="busca-membro" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Município (nome ou código IBGE)" maxLength={60} className="w-72 max-w-full rounded border border-slate-300 px-2 py-1" />
        <button type="submit" className="rounded bg-navy px-3 py-1 text-white">
          Buscar
        </button>
      </form>
      {achados && (
        <ul className="mt-2 space-y-1" aria-label="Municípios encontrados">
          {achados.length === 0 && <li className="text-slate-500">Nenhum município encontrado.</li>}
          {achados.map((m) => (
            <li key={m.codigo_ibge} className="flex items-center gap-2">
              {m.nome} — {m.uf} <span className="text-xs text-slate-500">{m.codigo_ibge}</span>
              {codigos.has(m.codigo_ibge) ? (
                <span className="text-xs text-slate-500">já é membro</span>
              ) : (
                <button type="button" onClick={() => alterar("POST", m)} className="rounded border border-navy px-2 py-0.5 text-xs text-navy">
                  Adicionar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3" aria-label="Membros atuais">
        {membros.map((m) => (
          <li key={m.codigo_ibge} className="flex items-center justify-between rounded border px-2 py-0.5">
            <span>
              {m.nome} — {m.uf}
            </span>
            <button type="button" onClick={() => alterar("DELETE", m)} aria-label={`Remover ${m.nome}`} className="text-xs text-red-700">
              Remover
            </button>
          </li>
        ))}
      </ul>
      {mensagem && (
        <p role="status" className="mt-2">
          {mensagem}
        </p>
      )}
    </details>
  );
}
