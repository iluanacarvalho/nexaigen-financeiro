"use client";

// Tabela do Território (rodada 16-A2) — a MESMA no Território (/crm/territorio)
// e na tela da entidade (/crm/entidades/[id]): filtros (todos combinados, na
// URL — link compartilhável), contagem sempre visível, legenda, ordenação,
// seleção com lote, "Abrir lead" por linha, exportação (admin) e visões
// salvas. Os dados vêm prontos do servidor (lib/territorioConsulta.ts); mudar
// filtro = navegar pra URL nova (o servidor recalcula).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ETAPAS_ABERTAS, ROTULO_ETAPA } from "@/lib/crm";
import {
  PLANOS_FILTRO,
  POR_PAGINA_TERRITORIO,
  ROTULO_PLANO_FILTRO,
  ROTULO_STATUS_COMERCIAL,
  STATUS_COMERCIAIS,
  leadVisivel,
  montarQueryTerritorio,
  motivoParaPular,
  textoContagem,
  type FiltrosTerritorio,
  type LinhaTerritorio,
  type OrdenacaoTerritorio,
  type PlanoFiltro,
  type ResumoTerritorio
} from "@/lib/territorio";
import { rotuloDoPlano } from "@/lib/planos";
import EtiquetasEntidades from "../EtiquetasEntidades";
import VisoesSalvas from "../VisoesSalvas";
import LoteLeads from "./LoteLeads";
import { Legenda, SeloPlano, SeloStatus } from "./SelosTerritorio";

export interface PropsTabelaTerritorio {
  tela: "territorio" | "entidade";
  /** Caminho da tela ("/crm/territorio" ou "/crm/entidades/<id>"). */
  base: string;
  entidadeId?: string;
  filtros: FiltrosTerritorio;
  avisos: string[];
  linhas: LinhaTerritorio[];
  total: number;
  resumo: ResumoTerritorio;
  admin: boolean;
  vendedores: { id: string; nome: string }[];
  /** Território: UFs que quem lê pode escolher. */
  ufs?: string[];
  microrregioes: string[];
  entidades: { id: string; nome: string; sigla: string | null }[];
  /** Parâmetros que a visão salva guarda nesta tela. */
  parametrosVisao: readonly string[];
}

const dataBr = (dia: string) => dia.split("-").reverse().join("/");
const pct = (v: number | null) => (v === null ? "—" : `${String(v).replace(".", ",")}%`);

function Numero({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className="text-xl font-bold text-navy">{valor}</p>
    </div>
  );
}

function AcaoDaLinha({ linha, aoAbrir, abrindo }: { linha: LinhaTerritorio; aoAbrir: () => void; abrindo: boolean }) {
  if (linha.status === "cliente" && linha.contrato) return <span className="text-xs text-emerald-800">Cliente desde {dataBr(linha.contrato.desde)}</span>;
  const lead = linha.lead;
  const elegivel = motivoParaPular(linha, "selecao") === null;
  return (
    <span className="flex flex-col items-start gap-1">
      {lead && leadVisivel(lead) && (
        <Link href={`/crm/${lead.id}`} className="text-xs text-navy underline">
          {lead.meu ? "Meu lead" : `Lead de ${lead.vendedor_nome}`} — etapa {ROTULO_ETAPA[lead.etapa]}
        </Link>
      )}
      {lead && !leadVisivel(lead) && (
        <span className="text-xs text-slate-700" data-testid="lead-de-colega">
          Com {lead.vendedor_nome} — etapa {ROTULO_ETAPA[lead.etapa]}
        </span>
      )}
      {elegivel && (
        <button type="button" onClick={aoAbrir} disabled={abrindo} className="rounded bg-navy px-2 py-0.5 text-xs text-white disabled:opacity-40">
          Abrir lead
        </button>
      )}
    </span>
  );
}

export default function TabelaTerritorio(p: PropsTabelaTerritorio) {
  const router = useRouter();
  const { filtros } = p;
  const [busca, setBusca] = useState(filtros.busca ?? "");
  const [popMin, setPopMin] = useState(filtros.populacaoMin?.toString() ?? "");
  const [popMax, setPopMax] = useState(filtros.populacaoMax?.toString() ?? "");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string; leadId?: string } | null>(null);

  const query = montarQueryTerritorio(filtros, { semPagina: true });
  const ir = (novos: Partial<FiltrosTerritorio>) => {
    const q = montarQueryTerritorio({ ...filtros, ...novos, pagina: novos.pagina ?? 1 });
    setSelecionados([]);
    router.push(q ? `${p.base}?${q}` : p.base);
  };
  const lerInteiro = (v: string) => (/^[0-9]+$/.test(v.trim()) ? Number(v.trim()) : undefined);

  function alternarPlano(plano: PlanoFiltro) {
    ir({ planos: filtros.planos.includes(plano) ? filtros.planos.filter((x) => x !== plano) : [...filtros.planos, plano] });
  }

  function ordenar(coluna: OrdenacaoTerritorio) {
    ir({ ordenar: coluna, direcao: filtros.ordenar === coluna && filtros.direcao === "asc" ? "desc" : "asc", pagina: filtros.pagina });
  }

  async function abrirLead(linha: LinhaTerritorio) {
    setAbrindo(linha.codigo_ibge);
    setMensagem(null);
    try {
      const res = await fetch("/api/territorio/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "criar", alvo: { modo: "selecao", codigos: [linha.codigo_ibge] } }) });
      const corpo = await res.json().catch(() => null);
      if (res.ok && corpo.criados.length === 1) {
        setMensagem({ tipo: "ok", texto: `Lead aberto para ${linha.nome}.`, leadId: corpo.criados[0].lead_id });
        router.refresh();
      } else setMensagem({ tipo: "erro", texto: corpo?.pulados?.[0]?.motivo ?? corpo?.erro ?? "Não foi possível abrir o lead." });
    } finally {
      setAbrindo(null);
    }
  }

  const ultima = Math.max(1, Math.ceil(p.total / POR_PAGINA_TERRITORIO));
  const exportar = (formato: "csv" | "xlsx") => `/api/territorio/exportar?${[query, p.entidadeId ? `entidade_tela=${p.entidadeId}` : "", `formato=${formato}`].filter(Boolean).join("&")}`;
  const todosDaPagina = p.linhas.map((l) => l.codigo_ibge);
  const tudoMarcado = todosDaPagina.length > 0 && todosDaPagina.every((c) => selecionados.includes(c));
  const cabecalhoOrdenavel = (coluna: OrdenacaoTerritorio, rotulo: string, alinhamento = "text-left") => (
    <th scope="col" className={`p-2 ${alinhamento}`} aria-sort={filtros.ordenar === coluna ? (filtros.direcao === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => ordenar(coluna)} className="font-semibold underline-offset-2 hover:underline">
        {rotulo}
        {filtros.ordenar === coluna ? (filtros.direcao === "asc" ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  return (
    <div>
      {p.avisos.length > 0 && (
        <ul role="status" aria-label="Avisos dos filtros" className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          {p.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      <section aria-label="Resumo" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Numero titulo="Prefeituras" valor={String(p.resumo.total)} />
        <Numero titulo="Clientes" valor={String(p.resumo.clientes)} />
        <Numero titulo="Em negociação" valor={String(p.resumo.em_negociacao)} />
        <Numero titulo="Perdidos" valor={String(p.resumo.perdidos)} />
        <Numero titulo="Ex-clientes" valor={String(p.resumo.ex_clientes)} />
        <Numero titulo="Não abordados" valor={String(p.resumo.nao_abordados)} />
        <Numero titulo="Cobertura (clientes ÷ total)" valor={pct(p.resumo.cobertura)} />
      </section>

      <form
        aria-label="Filtros"
        className="mb-3 grid gap-3 rounded-lg border bg-white p-3 text-sm shadow-sm sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          ir({ busca: busca.trim() || undefined, populacaoMin: lerInteiro(popMin), populacaoMax: lerInteiro(popMax) });
        }}
      >
        {p.tela === "territorio" && p.ufs && (
          <label className="block">
            <span className="text-slate-600">Estado (UF)</span>
            <select value={filtros.uf ?? ""} onChange={(e) => ir({ uf: e.target.value || undefined, microrregiao: undefined, entidade: undefined })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
              {p.ufs.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="sm:col-span-2">
          <legend className="text-slate-600">Plano</legend>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {PLANOS_FILTRO.map((plano) => (
              <label key={plano} className="flex items-center gap-1">
                <input type="checkbox" checked={filtros.planos.includes(plano)} onChange={() => alternarPlano(plano)} />
                {ROTULO_PLANO_FILTRO[plano]}
              </label>
            ))}
          </div>
          <label className="mt-1 flex items-center gap-1 text-xs">
            <input type="checkbox" checked={filtros.ignorarSugerido} onChange={(e) => ir({ ignorarSugerido: e.target.checked })} />
            Ignorar plano sugerido pela população (só contratado ou de interesse)
          </label>
        </fieldset>
        <label className="block">
          <span className="text-slate-600">Status</span>
          <select value={filtros.status ?? ""} onChange={(e) => ir({ status: (e.target.value || undefined) as FiltrosTerritorio["status"] })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            <option value="">Todos</option>
            {STATUS_COMERCIAIS.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS_COMERCIAL[s]}
              </option>
            ))}
          </select>
        </label>
        {p.tela === "territorio" && (
          <label className="block">
            <span className="text-slate-600">Entidade (associação/consórcio)</span>
            <select value={filtros.entidade ?? ""} onChange={(e) => ir({ entidade: e.target.value || undefined })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
              <option value="">Todas</option>
              {p.entidades.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.sigla ? `${e.sigla} — ${e.nome}` : e.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-slate-600">Etapa do lead</span>
          <select value={filtros.etapa ?? ""} onChange={(e) => ir({ etapa: (e.target.value || undefined) as FiltrosTerritorio["etapa"] })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            <option value="">Todas</option>
            {ETAPAS_ABERTAS.map((e) => (
              <option key={e} value={e}>
                {ROTULO_ETAPA[e]}
              </option>
            ))}
          </select>
        </label>
        {p.admin && (
          <label className="block">
            <span className="text-slate-600">Vendedor</span>
            <select value={filtros.vendedor ?? ""} onChange={(e) => ir({ vendedor: e.target.value || undefined })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
              <option value="">Todos</option>
              {p.vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        {p.microrregioes.length > 0 && (
          <label className="block">
            <span className="text-slate-600">Microrregião</span>
            <select value={filtros.microrregiao ?? ""} onChange={(e) => ir({ microrregiao: e.target.value || undefined })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
              <option value="">Todas</option>
              {p.microrregioes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex gap-2">
          <label className="block">
            <span className="text-slate-600">População de</span>
            <input value={popMin} onChange={(e) => setPopMin(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
          </label>
          <label className="block">
            <span className="text-slate-600">até</span>
            <input value={popMax} onChange={(e) => setPopMax(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
          </label>
        </div>
        <label className="block">
          <span className="text-slate-600">Município (nome ou código)</span>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} maxLength={60} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
        </label>
        <div className="flex flex-col justify-end gap-1">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={filtros.parado} onChange={(e) => ir({ parado: e.target.checked })} />
            Só lead parado (+14 dias)
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={filtros.acaoVencida} onChange={(e) => ir({ acaoVencida: e.target.checked })} />
            Só ação vencida
          </label>
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="rounded bg-navy px-3 py-1.5 text-white">
            Aplicar
          </button>
          <a href={p.tela === "territorio" && filtros.uf ? `${p.base}?uf=${filtros.uf}` : p.base} className="text-navy underline">
            Limpar filtros
          </a>
        </div>
      </form>

      <VisoesSalvas tela={p.tela} queryAtual={query} base={p.base} permitidos={p.parametrosVisao} />

      <Legenda />

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <p className="text-base font-semibold text-navy" data-testid="contagem" aria-live="polite">
          {textoContagem(p.total)}
        </p>
        {p.admin && (
          <span className="flex gap-3 text-sm">
            <a href={exportar("csv")} className="text-navy underline">
              Exportar CSV
            </a>
            <a href={exportar("xlsx")} className="text-navy underline">
              Exportar XLSX
            </a>
          </span>
        )}
      </div>

      <div className="mb-2 flex flex-wrap items-start gap-3">
        <LoteLeads
          rotulo={`Criar leads para os selecionados (${selecionados.length})`}
          alvo={{ modo: "selecao", codigos: selecionados }}
          admin={p.admin}
          vendedores={p.vendedores}
          desabilitado={selecionados.length === 0}
        />
        {p.tela === "territorio" && (
          <LoteLeads
            rotulo="Criar leads para todos os resultados ainda não abordados"
            alvo={{ modo: "nao_abordados", filtros: Object.fromEntries(new URLSearchParams(query)) }}
            admin={p.admin}
            vendedores={p.vendedores}
            desabilitado={p.total === 0}
          />
        )}
      </div>

      {mensagem && (
        <p role={mensagem.tipo === "erro" ? "alert" : "status"} className={`mb-2 text-sm ${mensagem.tipo === "erro" ? "text-red-700" : "text-emerald-800"}`}>
          {mensagem.texto}{" "}
          {mensagem.leadId && (
            <Link href={`/crm/${mensagem.leadId}`} className="underline">
              Ver o lead
            </Link>
          )}
        </p>
      )}

      {p.linhas.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-slate-600">Nenhuma prefeitura com estes filtros. Tente tirar algum filtro.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <caption className="sr-only">Prefeituras com status comercial e plano</caption>
            <thead className="bg-navy text-white">
              <tr>
                <th scope="col" className="p-2">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas desta página"
                    checked={tudoMarcado}
                    onChange={(e) => setSelecionados(e.target.checked ? [...new Set([...selecionados, ...todosDaPagina])] : selecionados.filter((c) => !todosDaPagina.includes(c)))}
                  />
                </th>
                {cabecalhoOrdenavel("nome", "Município")}
                {cabecalhoOrdenavel("populacao", "População", "text-right")}
                {cabecalhoOrdenavel("status", "Status")}
                {cabecalhoOrdenavel("plano", "Plano")}
                <th scope="col" className="p-2 text-left">
                  Ação
                </th>
              </tr>
            </thead>
            <tbody>
              {p.linhas.map((l) => (
                <tr key={l.codigo_ibge} id={`m-${l.codigo_ibge}`} className="border-t align-top target:bg-amber-50" data-testid={`linha-${l.codigo_ibge}`}>
                  <td className="p-2">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${l.nome}`}
                      checked={selecionados.includes(l.codigo_ibge)}
                      onChange={(e) => setSelecionados(e.target.checked ? [...selecionados, l.codigo_ibge] : selecionados.filter((c) => c !== l.codigo_ibge))}
                    />
                  </td>
                  <td className="p-2">
                    <span className="font-medium text-slate-900">
                      {l.nome} — {l.uf}
                    </span>
                    {l.microrregiao && <span className="block text-[11px] text-slate-500">{l.microrregiao}</span>}
                    {l.cliente_sem_codigo && <span className="block text-[11px] text-amber-700">cliente sem código IBGE, corrigir</span>}
                    <EtiquetasEntidades entidades={l.entidades} />
                  </td>
                  <td className="p-2 text-right tabular-nums">{l.populacao === null ? "—" : l.populacao.toLocaleString("pt-BR")}</td>
                  <td className="p-2">
                    <SeloStatus linha={l} />
                  </td>
                  <td className="p-2">
                    <SeloPlano plano={l.plano} />
                    {l.contrato && l.plano.origem !== "contratado" && <span className="block text-[11px] text-slate-500">contratado: {rotuloDoPlano(l.contrato.plano)}</span>}
                  </td>
                  <td className="p-2">
                    <AcaoDaLinha linha={l} aoAbrir={() => void abrirLead(l)} abrindo={abrindo === l.codigo_ibge} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ultima > 1 && (
        <nav aria-label="Paginação" className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>
            Página {filtros.pagina} de {ultima}
          </span>
          <span className="flex gap-2">
            <button type="button" disabled={filtros.pagina <= 1} onClick={() => ir({ pagina: filtros.pagina - 1 })} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">
              Anterior
            </button>
            <button type="button" disabled={filtros.pagina >= ultima} onClick={() => ir({ pagina: filtros.pagina + 1 })} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">
              Próxima
            </button>
          </span>
        </nav>
      )}
    </div>
  );
}
