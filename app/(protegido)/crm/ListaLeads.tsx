"use client";

// Visão em LISTA do CRM (rodada 16-A): filtros, ordenação e paginação no
// SERVIDOR (GET /api/leads — o escopo de quem lê vale lá: vendas só os
// seus). Filtro por vendedor e exportação: só admin (a API recusa pros
// demais). Mesmos selos do funil.

import Link from "next/link";
import { useEffect, useState } from "react";
import Paginacao from "@/components/Paginacao";
import { formatarMoeda } from "@/lib/dinheiro";
import { ETAPAS, ORIGENS, ROTULO_ETAPA, ROTULO_ORIGEM } from "@/lib/crm";
import { UF_POR_CODIGO } from "@/lib/ibge";
import type { LeadListado } from "@/lib/crmRepositorio";
import Selos from "./Selos";

const POR_PAGINA = 25;
const UFS = Object.values(UF_POR_CODIGO).sort();

interface Filtros {
  etapa: string;
  uf: string;
  origem: string;
  busca: string;
  vendedor_id: string;
  parados: boolean;
  vencidas: boolean;
  ordenar: string;
  direcao: "asc" | "desc";
}

const INICIAIS: Filtros = { etapa: "", uf: "", origem: "", busca: "", vendedor_id: "", parados: false, vencidas: false, ordenar: "atualizado", direcao: "desc" };

export function montarQueryLeads(f: Filtros, pagina?: number): string {
  const p = new URLSearchParams({ ordenar: f.ordenar, direcao: f.direcao });
  if (pagina !== undefined) {
    p.set("pagina", String(pagina));
    p.set("por_pagina", String(POR_PAGINA));
  }
  for (const chave of ["etapa", "uf", "origem", "vendedor_id"] as const) if (f[chave]) p.set(chave, f[chave]);
  if (f.busca.trim()) p.set("busca", f.busca.trim());
  if (f.parados) p.set("parados", "true");
  if (f.vencidas) p.set("vencidas", "true");
  return p.toString();
}

export default function ListaLeads({ admin, vendedores, etapaInicial }: { admin: boolean; vendedores: { id: string; nome: string }[]; etapaInicial?: string }) {
  // "Ver todos os N desta etapa" (funil) abre a lista já filtrada pela etapa.
  const [filtros, setFiltros] = useState<Filtros>(etapaInicial ? { ...INICIAIS, etapa: etapaInicial } : INICIAIS);
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<{ leads: LeadListado[]; total: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/leads?${montarQueryLeads(filtros, pagina)}`).then(async (res) => {
      if (!ativo) return;
      if (!res.ok) {
        setErro("Não foi possível carregar os leads — confira os filtros.");
        return;
      }
      setErro(null);
      setDados(await res.json());
    });
    return () => {
      ativo = false;
    };
  }, [filtros, pagina]);

  const mudar = (novos: Partial<Filtros>) => {
    setFiltros((f) => ({ ...f, ...novos }));
    setPagina(1);
  };

  return (
    <section aria-label="Lista de leads">
      <form aria-label="Filtros de leads" className="mb-3 grid gap-2 rounded-lg border bg-white p-3 text-sm shadow-sm sm:grid-cols-3 lg:grid-cols-6" onSubmit={(e) => e.preventDefault()}>
        <label className="block">
          <span className="text-slate-600">Etapa</span>
          <select value={filtros.etapa} onChange={(e) => mudar({ etapa: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            <option value="">Todas</option>
            {ETAPAS.filter((e) => e !== "ganho").map((e) => (
              <option key={e} value={e}>
                {ROTULO_ETAPA[e]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-slate-600">UF</span>
          <select value={filtros.uf} onChange={(e) => mudar({ uf: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            <option value="">Todas</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-slate-600">Origem</span>
          <select value={filtros.origem} onChange={(e) => mudar({ origem: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            <option value="">Todas</option>
            {ORIGENS.map((o) => (
              <option key={o} value={o}>
                {ROTULO_ORIGEM[o]}
              </option>
            ))}
          </select>
        </label>
        {admin && (
          <label className="block">
            <span className="text-slate-600">Vendedor</span>
            <select value={filtros.vendedor_id} onChange={(e) => mudar({ vendedor_id: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
              <option value="">Todos</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-slate-600">Município</span>
          <input value={filtros.busca} onChange={(e) => mudar({ busca: e.target.value })} maxLength={60} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
        </label>
        <label className="block">
          <span className="text-slate-600">Ordenar por</span>
          <select value={filtros.ordenar} onChange={(e) => mudar({ ordenar: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            <option value="atualizado">Atualização</option>
            <option value="ultima_atividade">Última atividade</option>
            <option value="proxima_acao">Próxima ação</option>
            <option value="valor">Valor estimado</option>
            <option value="municipio">Município</option>
            <option value="etapa">Etapa</option>
          </select>
        </label>
        <label className="block">
          <span className="text-slate-600">Ordem</span>
          <select value={filtros.direcao} onChange={(e) => mudar({ direcao: e.target.value as "asc" | "desc" })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            <option value="desc">Decrescente</option>
            <option value="asc">Crescente</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={filtros.parados} onChange={(e) => mudar({ parados: e.target.checked })} />
          <span>Só parados (+14 dias)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={filtros.vencidas} onChange={(e) => mudar({ vencidas: e.target.checked })} />
          <span>Só ação vencida</span>
        </label>
      </form>
      {admin && (
        <p className="mb-2 flex gap-3 text-sm">
          <a href={`/api/leads/exportar?${montarQueryLeads(filtros)}&formato=csv`} className="text-navy underline">
            Exportar CSV
          </a>
          <a href={`/api/leads/exportar?${montarQueryLeads(filtros)}&formato=xlsx`} className="text-navy underline">
            Exportar XLSX
          </a>
        </p>
      )}
      {erro && <p className="mb-2 text-sm text-red-600">{erro}</p>}
      {dados && dados.leads.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-slate-500">
          {JSON.stringify(filtros) === JSON.stringify(INICIAIS) ? "Nenhum lead ainda." : "Nenhum lead com estes filtros."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="p-2 text-left">Município</th>
                <th className="p-2 text-left">Etapa</th>
                <th className="p-2 text-right">Valor estimado</th>
                {admin && <th className="p-2 text-left">Vendedor</th>}
                <th className="p-2 text-left">Próxima ação</th>
                <th className="p-2 text-left">Situação</th>
              </tr>
            </thead>
            <tbody>
              {dados?.leads.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-2">
                    <Link href={`/crm/${l.id}`} className="text-navy underline">
                      {l.municipio_nome} — {l.uf}
                    </Link>
                  </td>
                  <td className="p-2">{ROTULO_ETAPA[l.etapa]}</td>
                  <td className="p-2 text-right">{l.valor_mensal_estimado_centavos === null ? "—" : formatarMoeda(l.valor_mensal_estimado_centavos)}</td>
                  {admin && <td className="p-2">{l.vendedor_nome}</td>}
                  <td className="p-2">{l.proxima_acao_em ? l.proxima_acao_em.split("-").reverse().join("/") : "—"}</td>
                  <td className="p-2">
                    <span className="flex flex-wrap gap-1">
                      <Selos lead={l} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dados && <Paginacao pagina={pagina} porPagina={POR_PAGINA} total={dados.total} onMudar={setPagina} />}
    </section>
  );
}
