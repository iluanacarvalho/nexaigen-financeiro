"use client";

// Criar leads em lote (rodada 16-A2) com PRÉVIA e confirmação: quantas
// serão criadas, quais serão puladas e por quê. Só depois de confirmar o
// servidor grava (POST /api/territorio/leads, uma transação). Admin escolhe
// o vendedor; vendas cria pra si.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type AlvoLoteTela = { modo: "selecao"; codigos: string[] } | { modo: "nao_abordados"; filtros: Record<string, string>; entidade_id?: string };

interface Item {
  codigo_ibge: string;
  nome: string;
  uf: string;
}
interface Pulado extends Item {
  motivo: string;
}

export default function LoteLeads({
  rotulo,
  alvo,
  admin,
  vendedores,
  destaque = false,
  desabilitado = false
}: {
  rotulo: string;
  alvo: AlvoLoteTela;
  admin: boolean;
  vendedores: { id: string; nome: string }[];
  destaque?: boolean;
  desabilitado?: boolean;
}) {
  const router = useRouter();
  const [previa, setPrevia] = useState<{ criar: Item[]; pulados: Pulado[] } | null>(null);
  const [resultado, setResultado] = useState<{ criados: (Item & { lead_id: string })[]; pulados: Pulado[] } | null>(null);
  const [vendedor, setVendedor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function chamar(acao: "previa" | "criar") {
    setErro(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/territorio/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao, alvo, ...(admin && vendedor ? { vendedor_id: vendedor } : {}) })
      });
      const corpo = await res.json().catch(() => null);
      if (!res.ok) {
        setErro(corpo?.erro ?? "Não foi possível concluir.");
        return;
      }
      if (acao === "previa") setPrevia(corpo);
      else {
        setPrevia(null);
        setResultado(corpo);
        router.refresh();
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={desabilitado || enviando}
        onClick={() => {
          setResultado(null);
          void chamar("previa");
        }}
        className={destaque ? "rounded bg-teal px-4 py-2 font-semibold text-white disabled:opacity-40" : "rounded border border-navy px-3 py-1 text-sm text-navy disabled:opacity-40"}
      >
        {rotulo}
      </button>
      {erro && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {erro}
        </p>
      )}
      {previa && (
        <section role="dialog" aria-label="Prévia da criação de leads" className="mt-2 rounded-lg border border-teal bg-white p-4 text-sm shadow">
          <h3 className="font-semibold text-navy" data-testid="previa-resumo">
            {previa.criar.length === 0 ? "Nenhum lead será criado." : `${previa.criar.length} ${previa.criar.length === 1 ? "lead será criado" : "leads serão criados"}`}
            {previa.pulados.length > 0 && ` · ${previa.pulados.length} ${previa.pulados.length === 1 ? "prefeitura será pulada" : "prefeituras serão puladas"}`}
          </h3>
          {previa.criar.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer">Ver as que terão lead</summary>
              <ul className="ml-4 list-disc">
                {previa.criar.map((i) => (
                  <li key={i.codigo_ibge}>
                    {i.nome} — {i.uf}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {previa.pulados.length > 0 && (
            <div className="mt-2">
              <p className="font-medium">Puladas, e por quê:</p>
              <ul className="ml-4 list-disc" aria-label="Puladas">
                {previa.pulados.map((p) => (
                  <li key={p.codigo_ibge}>
                    {p.nome}
                    {p.uf ? ` — ${p.uf}` : ""}: {p.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {admin && previa.criar.length > 0 && (
            <label className="mt-2 block">
              <span className="text-slate-600">Vendedor dos novos leads</span>
              <select value={vendedor} onChange={(e) => setVendedor(e.target.value)} className="ml-2 rounded border border-slate-300 px-2 py-1">
                <option value="">Eu mesmo</option>
                {vendedores.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={previa.criar.length === 0 || enviando} onClick={() => void chamar("criar")} className="rounded bg-teal px-3 py-1 font-medium text-white disabled:opacity-40">
              Confirmar e criar {previa.criar.length} {previa.criar.length === 1 ? "lead" : "leads"}
            </button>
            <button type="button" onClick={() => setPrevia(null)} className="rounded border border-slate-300 px-3 py-1">
              Cancelar
            </button>
          </div>
        </section>
      )}
      {resultado && (
        <section role="status" aria-label="Resultado da criação de leads" className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-emerald-900">
            {resultado.criados.length} {resultado.criados.length === 1 ? "lead criado" : "leads criados"}
            {resultado.pulados.length > 0 && ` · ${resultado.pulados.length} puladas`}
          </p>
          <ul className="ml-4 list-disc">
            {resultado.criados.slice(0, 20).map((c) => (
              <li key={c.lead_id}>
                <Link href={`/crm/${c.lead_id}`} className="text-navy underline">
                  {c.nome} — {c.uf}
                </Link>
              </li>
            ))}
            {resultado.criados.length > 20 && <li>… e mais {resultado.criados.length - 20}.</li>}
          </ul>
          {resultado.pulados.length > 0 && (
            <ul className="ml-4 mt-1 list-disc text-slate-700">
              {resultado.pulados.map((p) => (
                <li key={p.codigo_ibge}>
                  {p.nome}: {p.motivo}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
