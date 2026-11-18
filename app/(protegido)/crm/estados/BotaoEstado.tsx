"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function BotaoEstado({ uf, liberado, semBase }: { uf: string; liberado: boolean; semBase: boolean }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  async function alternar() {
    setErro(null);
    const res = await fetch(`/api/estados/${uf}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ liberado: !liberado }) });
    if (!res.ok) setErro((await res.json().catch(() => null))?.erro ?? "Não foi possível alterar.");
    router.refresh();
  }
  if (!liberado && semBase) return <span className="text-xs text-slate-500">carregue a base antes de liberar</span>;
  return (
    <span>
      <button type="button" onClick={alternar} className={liberado ? "rounded border border-slate-300 px-2 py-0.5 text-xs" : "rounded bg-teal px-2 py-0.5 text-xs text-white"}>
        {liberado ? `Bloquear ${uf}` : `Liberar ${uf}`}
      </button>
      {erro && (
        <span role="alert" className="ml-2 text-xs text-red-700">
          {erro}
        </span>
      )}
    </span>
  );
}
