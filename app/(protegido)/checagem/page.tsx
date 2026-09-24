"use client";

import { useEffect, useState } from "react";

export default function FilaChecagemPage() {
  const [notas, setNotas] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    const res = await fetch("/api/notas?status=aguardando_atesto");
    const data = await res.json();
    setNotas(data.notas ?? []);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  async function registrar(notaId: string, resultado: string) {
    await fetch(`/api/notas/${notaId}/verificar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resultado })
    });
    carregar();
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-2 text-2xl font-bold text-navy">Fila de Checagem — Atesto</h1>
      <p className="mb-6 text-sm text-slate-500">
        Notas emitidas sem atesto registrado ainda. Abra o portal de cada prefeitura, confira o status e registre o
        que encontrou — leva alguns segundos por nota.
      </p>

      {carregando && <p className="text-sm text-slate-400">Carregando...</p>}

      <div className="space-y-3">
        {notas.map((n) => (
          <div key={n.id} className="flex items-center justify-between rounded-lg border bg-white p-4 shadow-sm">
            <div>
              <p className="font-semibold text-navy">
                {n.cliente?.nome} — {n.cliente?.uf}
              </p>
              <p className="text-sm text-slate-500">
                NF {n.numero_nf ?? "—"} · {Number(n.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ·
                emitida em {n.data_emissao} · sistema: {n.cliente?.sistema_portal ?? "—"}
              </p>
              {n.cliente?.portal_url && (
                <a href={n.cliente.portal_url} target="_blank" rel="noreferrer" className="text-sm text-teal underline">
                  Abrir portal da prefeitura →
                </a>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => registrar(n.id, "sem_atesto_ainda")}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Ainda sem atesto
              </button>
              <button
                onClick={() => registrar(n.id, "atestada")}
                className="rounded bg-teal px-3 py-1.5 text-sm text-white hover:opacity-90"
              >
                Atestada hoje
              </button>
            </div>
          </div>
        ))}
        {!carregando && notas.length === 0 && (
          <p className="rounded-lg border bg-white p-6 text-center text-sm text-slate-400">
            Nenhuma nota pendente de checagem. 🎉
          </p>
        )}
      </div>
    </main>
  );
}
