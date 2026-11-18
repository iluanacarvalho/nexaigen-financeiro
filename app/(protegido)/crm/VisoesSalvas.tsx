"use client";

// Visões salvas (rodada 16-A2): a pessoa dá um nome à combinação de filtros
// da tela e reabre com um clique. Cada pessoa vê só as suas (a API filtra
// pelo usuário). Filtro salvo que hoje aponta pra entidade removida ou
// estado não liberado não quebra nada: a tela ignora e avisa.

import { useEffect, useState } from "react";

interface Visao {
  id: string;
  nome: string;
  filtros: Record<string, string>;
}

async function buscarVisoes(tela: string): Promise<Visao[] | null> {
  const res = await fetch(`/api/crm/visoes?tela=${tela}`);
  return res.ok ? (await res.json()).visoes : null;
}

export default function VisoesSalvas({ tela, queryAtual, base, permitidos }: { tela: "territorio" | "leads" | "entidade"; queryAtual: string; base: string; permitidos: readonly string[] }) {
  const [visoes, setVisoes] = useState<Visao[]>([]);
  const [nome, setNome] = useState("");
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregar = async () => {
    const v = await buscarVisoes(tela);
    if (v) setVisoes(v);
  };

  useEffect(() => {
    let ativo = true;
    buscarVisoes(tela).then((v) => {
      if (ativo && v) setVisoes(v);
    });
    return () => {
      ativo = false;
    };
  }, [tela]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setMensagem(null);
    const filtros = Object.fromEntries([...new URLSearchParams(queryAtual)].filter(([k]) => permitidos.includes(k)));
    const res = await fetch("/api/crm/visoes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nome: nome.trim(), tela, filtros }) });
    const corpo = await res.json().catch(() => null);
    if (!res.ok) {
      setMensagem({ tipo: "erro", texto: corpo?.detalhes?.fieldErrors?.nome?.[0] ?? corpo?.erro ?? "Não foi possível salvar a visão." });
      return;
    }
    setNome("");
    setMensagem({ tipo: "ok", texto: "Visão salva." });
    await carregar();
  }

  async function excluir(v: Visao) {
    const res = await fetch(`/api/crm/visoes/${v.id}`, { method: "DELETE" });
    if (res.ok) await carregar();
  }

  const abrir = (v: Visao) => {
    const q = new URLSearchParams(v.filtros).toString();
    return `${base}${base.includes("?") ? "&" : "?"}${q}`;
  };

  return (
    <section aria-label="Visões salvas" className="mb-3 rounded-lg border bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-navy">Minhas visões:</span>
        {visoes.length === 0 ? (
          <span className="text-slate-500">nenhuma ainda.</span>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {visoes.map((v) => (
              <li key={v.id} className="flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5">
                <a href={abrir(v)} className="text-navy underline">
                  {v.nome}
                </a>
                <button type="button" onClick={() => excluir(v)} aria-label={`Excluir a visão ${v.nome}`} className="text-xs text-slate-500 hover:text-red-700">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={salvar} className="mt-2 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-xs text-slate-600">Salvar os filtros atuais como</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder="ex.: Pequeno porte no consórcio X" className="mt-0.5 block w-64 max-w-full rounded border border-slate-300 px-2 py-1" />
        </label>
        <button type="submit" disabled={nome.trim() === ""} className="rounded bg-navy px-3 py-1 text-white disabled:opacity-40">
          Salvar visão
        </button>
        {mensagem && (
          <span role={mensagem.tipo === "erro" ? "alert" : "status"} className={mensagem.tipo === "erro" ? "text-red-700" : "text-emerald-700"}>
            {mensagem.texto}
          </span>
        )}
      </form>
    </section>
  );
}
