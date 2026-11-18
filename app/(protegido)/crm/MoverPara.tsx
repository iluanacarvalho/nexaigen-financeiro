"use client";

// "Mover para…" (rodada 16-A) — muda a etapa de um lead SEM arrastar:
// select + botão (acessível por teclado). Perdido pede o motivo (lista) e um
// detalhe opcional. Num lead perdido, só "Reabrir". 'Ganho' NÃO aparece:
// o fechamento é o fluxo da rodada 16-B (a API também recusa).

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ETAPAS_ABERTAS, MOTIVOS_PERDA, ROTULO_ETAPA, ROTULO_MOTIVO_PERDA, type Etapa, type MotivoPerda } from "@/lib/crm";

export default function MoverPara({ leadId, etapa, municipio, onMudou }: { leadId: string; etapa: Etapa; municipio: string; onMudou?: () => void }) {
  const router = useRouter();
  const [destino, setDestino] = useState<string>("");
  const [motivo, setMotivo] = useState<MotivoPerda | "">("");
  const [detalhe, setDetalhe] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(corpo: object) {
    setEnviando(true);
    setErro(null);
    const res = await fetch(`/api/leads/${leadId}/etapa`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    const d = await res.json().catch(() => null);
    setEnviando(false);
    if (!res.ok) {
      const detalhes = d?.detalhes ? [...(d.detalhes.formErrors ?? []), ...Object.values(d.detalhes.fieldErrors ?? {}).flat()].join(" ") : "";
      return setErro(detalhes || d?.erro || "Não foi possível mudar a etapa.");
    }
    setDestino("");
    setMotivo("");
    setDetalhe("");
    onMudou?.();
    router.refresh();
  }

  if (etapa === "perdido") {
    return (
      <div className="text-xs">
        <button type="button" onClick={() => enviar({ acao: "reabrir" })} disabled={enviando} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50">
          Reabrir (volta para Contato)
        </button>
        {erro && (
          <p role="alert" className="mt-1 text-red-600">
            {erro}
          </p>
        )}
      </div>
    );
  }
  if (etapa === "ganho") return null;

  return (
    <form
      aria-label={`Mover ${municipio}`}
      className="text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (!destino) return;
        if (destino === "perdido") enviar({ acao: "perder", motivo, detalhe: detalhe.trim() || null });
        else enviar({ acao: "mover", etapa: destino });
      }}
    >
      <div className="flex flex-wrap items-center gap-1">
        <label className="sr-only" htmlFor={`mover-${leadId}`}>
          Mover {municipio} para
        </label>
        <select id={`mover-${leadId}`} value={destino} onChange={(e) => setDestino(e.target.value)} className="rounded border border-slate-300 px-1 py-1">
          <option value="">Mover para…</option>
          {ETAPAS_ABERTAS.filter((e) => e !== etapa).map((e) => (
            <option key={e} value={e}>
              {ROTULO_ETAPA[e]}
            </option>
          ))}
          <option value="perdido">Perdido</option>
        </select>
        <button type="submit" disabled={!destino || enviando || (destino === "perdido" && !motivo)} className="rounded bg-navy px-2 py-1 text-white disabled:opacity-50">
          Mover
        </button>
      </div>
      {destino === "perdido" && (
        <div className="mt-1 space-y-1">
          <label className="block">
            <span className="text-slate-600">Motivo da perda</span>
            <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoPerda)} className="mt-0.5 block w-full rounded border border-slate-300 px-1 py-1">
              <option value="">Selecione…</option>
              {MOTIVOS_PERDA.map((m) => (
                <option key={m} value={m}>
                  {ROTULO_MOTIVO_PERDA[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-slate-600">Detalhe (opcional)</span>
            <input value={detalhe} maxLength={1000} onChange={(e) => setDetalhe(e.target.value)} className="mt-0.5 block w-full rounded border border-slate-300 px-1 py-1" />
          </label>
        </div>
      )}
      {erro && (
        <p role="alert" className="mt-1 text-red-600">
          {erro}
        </p>
      )}
    </form>
  );
}
