"use client";

// "Já existe esse lead?" (rodada 16-A, ajuste) — busca em TODOS os leads
// por GET /api/leads/consulta, que devolve SÓ os campos mínimos (município,
// UF, etapa, vendedor, dia da última atividade, meu_lead, pode_pedir). Lead
// de colega aparece como "já está com <vendedor>, etapa <etapa>"; se estiver
// parado há mais de 60 dias, botão "Pedir este lead" (o admin decide).
// Usado no topo de /crm e, com `municipio`/`uf` controlados, no cadastro.

import Link from "next/link";
import { useEffect, useState } from "react";
import { ROTULO_ETAPA, type Etapa } from "@/lib/crm";

export interface ResultadoConsulta {
  id: string;
  municipio_nome: string;
  uf: string;
  etapa: Etapa;
  vendedor_nome: string;
  ultima_atividade_em: string;
  meu_lead: boolean;
  pode_pedir: boolean;
}

export const textoJaExiste = (r: Pick<ResultadoConsulta, "vendedor_nome" | "etapa">) => `Já existe esse lead: está com ${r.vendedor_nome}, etapa ${ROTULO_ETAPA[r.etapa]}.`;

export async function consultar(busca: string, uf?: string): Promise<ResultadoConsulta[]> {
  const p = new URLSearchParams({ busca, por_pagina: "20" });
  if (uf) p.set("uf", uf);
  const res = await fetch(`/api/leads/consulta?${p}`);
  if (!res.ok) return [];
  return (await res.json()).leads ?? [];
}

const dataBr = (dia: string) => dia.split("-").reverse().join("/");

export function LinhaConsulta({ r }: { r: ResultadoConsulta }) {
  const [pedido, setPedido] = useState<"enviando" | "ok" | string | null>(null);
  async function pedir() {
    setPedido("enviando");
    const res = await fetch(`/api/leads/${r.id}/pedidos`, { method: "POST" });
    const d = await res.json().catch(() => null);
    setPedido(res.ok ? "ok" : (d?.erro ?? "Não foi possível pedir o lead."));
  }
  return (
    <li className="flex flex-wrap items-center gap-2 py-1 text-sm" data-testid="resultado-consulta">
      <span className="font-medium">
        {r.municipio_nome} — {r.uf}
      </span>
      {r.meu_lead ? (
        <Link href={`/crm/${r.id}`} className="text-navy underline">
          Seu lead · {ROTULO_ETAPA[r.etapa]}
        </Link>
      ) : (
        <span className="text-slate-600">
          {textoJaExiste(r)} Última atividade: {dataBr(r.ultima_atividade_em)}.
        </span>
      )}
      {r.pode_pedir && pedido !== "ok" && (
        <button type="button" onClick={pedir} disabled={pedido === "enviando"} className="rounded border border-navy px-2 py-0.5 text-xs text-navy disabled:opacity-50">
          Pedir este lead
        </button>
      )}
      {pedido === "ok" && <span className="text-xs text-teal">Pedido enviado — o administrador vai decidir.</span>}
      {pedido && pedido !== "ok" && pedido !== "enviando" && (
        <span role="alert" className="text-xs text-red-600">
          {pedido}
        </span>
      )}
    </li>
  );
}

/** Campo de busca do topo do CRM. */
export default function ConsultaLead() {
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ResultadoConsulta[] | null>(null);

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) return;
    let ativo = true;
    const espera = setTimeout(() => {
      consultar(termo).then((r) => ativo && setResultados(r));
    }, 300);
    return () => {
      ativo = false;
      clearTimeout(espera);
    };
  }, [busca]);

  const termo = busca.trim();
  return (
    <section aria-label="Já existe esse lead?" className="mb-6 rounded-lg border bg-white p-4 shadow-sm">
      <label className="block text-sm">
        <span className="font-semibold text-navy">Já existe esse lead?</span>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Digite o município (sem precisar de acento)"
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
        />
      </label>
      {termo.length >= 2 && resultados !== null && (
        resultados.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nenhum lead com esse nome — pode cadastrar.</p>
        ) : (
          <ul className="mt-2 divide-y">
            {resultados.map((r) => (
              <LinhaConsulta key={r.id} r={r} />
            ))}
          </ul>
        )
      )}
    </section>
  );
}
