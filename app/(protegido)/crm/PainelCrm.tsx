"use client";

// Tela principal do CRM (rodada 16-A). Dados prontos do Server Component
// (./page.tsx — mesmas funções da API, no escopo de quem lê: vendas só vê
// os seus leads). Aqui: números do funil, "Minhas ações de hoje", (admin)
// pedidos de reatribuição e carga por vendedor, e a alternância entre o
// FUNIL (colunas por etapa, "Mover para…" sem arrastar) e a LISTA (filtros e
// ordenação no servidor, GET /api/leads).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatarMoeda } from "@/lib/dinheiro";
import { ETAPAS_ABERTAS, ROTULO_ETAPA, ROTULO_MOTIVO_PERDA, type Etapa, type MotivoPerda } from "@/lib/crm";
import type { LeadListado, ResumoCrm } from "@/lib/crmRepositorio";
import ConsultaLead from "./ConsultaLead";
import ListaLeads from "./ListaLeads";
import MoverPara from "./MoverPara";
import Selos from "./Selos";

const dataBr = (dia: string) => dia.split("-").reverse().join("/");

export function CartaoLead({ lead, admin }: { lead: LeadListado; admin: boolean }) {
  return (
    <li className="rounded border bg-white p-2 text-sm shadow-sm" data-testid={`cartao-${lead.id}`}>
      <Link href={`/crm/${lead.id}`} className="font-medium text-navy hover:underline">
        {lead.municipio_nome} — {lead.uf}
      </Link>
      {lead.contato_nome && <p className="text-xs text-slate-600">{lead.contato_nome}</p>}
      <p className="text-xs text-slate-700">{lead.valor_mensal_estimado_centavos === null ? "Sem valor estimado" : `${formatarMoeda(lead.valor_mensal_estimado_centavos)}/mês`}</p>
      {admin && <p className="text-xs text-slate-500">Vendedor: {lead.vendedor_nome}</p>}
      <div className="my-1 flex flex-wrap gap-1">
        <Selos lead={lead} />
      </div>
      <MoverPara leadId={lead.id} etapa={lead.etapa} municipio={lead.municipio_nome} />
    </li>
  );
}

function Numero({ titulo, valor, legenda }: { titulo: string; valor: string; legenda?: string }) {
  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className="text-xl font-bold text-navy">{valor}</p>
      {legenda && <p className="text-[11px] text-slate-400">{legenda}</p>}
    </div>
  );
}

/** Link pra lista paginada já filtrada pela etapa (sempre que a coluna mostra menos do que o total). */
export function hrefVerTodos(etapa: Etapa): string {
  return `/crm?visao=lista&etapa=${etapa}`;
}

function VerTodos({ etapa, total, mostrados }: { etapa: Etapa; total: number; mostrados: number }) {
  if (total <= mostrados) return null;
  return (
    <a href={hrefVerTodos(etapa)} className="mt-2 block text-xs font-medium text-navy underline" data-testid={`ver-todos-${etapa}`}>
      Ver todos os {total} desta etapa (mostrando {mostrados})
    </a>
  );
}

export default function PainelCrm({
  resumo,
  funil,
  admin,
  vendedores,
  visaoInicial = "funil",
  etapaInicial
}: {
  resumo: ResumoCrm;
  /** Até CARTOES_POR_ETAPA cartões por etapa (lib/crmRepositorio.ts#listarFunil); os totais vêm de `resumo.porEtapa`. */
  funil: Record<Etapa, LeadListado[]>;
  admin: boolean;
  vendedores: { id: string; nome: string }[];
  visaoInicial?: "funil" | "lista";
  etapaInicial?: Etapa;
}) {
  const router = useRouter();
  const [visao, setVisao] = useState<"funil" | "lista">(visaoInicial);
  const [erroPedido, setErroPedido] = useState<string | null>(null);
  const total = (etapa: Etapa) => resumo.porEtapa.find((e) => e.etapa === etapa)?.quantidade ?? 0;
  const semLeads = resumo.porEtapa.every((e) => e.quantidade === 0);
  const perdidos = funil.perdido;

  async function decidir(pedidoId: string, decisao: "aprovado" | "negado") {
    setErroPedido(null);
    const res = await fetch(`/api/leads/pedidos/${pedidoId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decisao }) });
    if (!res.ok) setErroPedido((await res.json().catch(() => null))?.erro ?? "Não foi possível decidir o pedido.");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-navy">CRM — leads</h1>
        <Link href="/crm/novo" className="rounded bg-navy px-4 py-2 text-sm text-white">
          + Novo lead
        </Link>
      </div>

      <ConsultaLead />

      <section aria-label="Números do funil" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Numero titulo="Leads abertos" valor={String(resumo.abertos.quantidade)} />
        <Numero titulo="Valor mensal estimado em aberto" valor={formatarMoeda(resumo.abertos.valorCentavos)} />
        <Numero titulo="Ganhos no mês" valor="—" legenda="O fechamento (lead → cliente) entra na rodada 16-B." />
        <Numero titulo="Perdidos no mês" valor={String(resumo.perdidosNoMes)} />
      </section>

      <section aria-label="Taxa de avanço por etapa" className="mb-6 rounded-lg border bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold text-navy">Taxa de avanço por etapa</h2>
        <p className="mb-2 text-xs text-slate-500">Dos leads que chegaram numa etapa, quantos já chegaram na seguinte (considerando a etapa mais avançada que cada lead alcançou).</p>
        <ul className="flex flex-wrap gap-4">
          {resumo.taxasDeAvanco.map((t) => (
            <li key={t.de} data-testid={`taxa-${t.de}`}>
              {ROTULO_ETAPA[t.de]} → {ROTULO_ETAPA[t.para]}:{" "}
              <strong>{t.percentual === null ? "—" : `${String(t.percentual).replace(".", ",")}%`}</strong>{" "}
              <span className="text-xs text-slate-500">
                ({t.passaram} de {t.entraram})
              </span>
            </li>
          ))}
        </ul>
      </section>

      {resumo.minhasAcoes.length > 0 && (
        <section aria-label="Minhas ações de hoje" className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <h2 className="font-semibold text-amber-900">Minhas ações de hoje</h2>
          <ul className="mt-1 space-y-1">
            {resumo.minhasAcoes.map((a) => (
              <li key={a.id}>
                <Link href={`/crm/${a.id}`} className="font-medium text-navy underline">
                  {a.municipio_nome} — {a.uf}
                </Link>{" "}
                · {a.proxima_acao_em < resumo.hoje ? <span className="font-medium text-alerta">vencida em {dataBr(a.proxima_acao_em)}</span> : "hoje"}
                {a.proxima_acao_descricao ? ` · ${a.proxima_acao_descricao}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {admin && resumo.pedidosPendentes && resumo.pedidosPendentes.length > 0 && (
        <section aria-label="Pedidos de reatribuição" className="mb-6 rounded-lg border bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold text-navy">Pedidos de reatribuição pendentes</h2>
          <ul className="mt-1 space-y-1">
            {resumo.pedidosPendentes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {p.solicitante_nome} pede <strong>{p.municipio_nome} — {p.uf}</strong> (hoje com {p.dono_nome})
                </span>
                <button type="button" onClick={() => decidir(p.id, "aprovado")} className="rounded bg-teal px-2 py-0.5 text-xs text-white">
                  Aprovar
                </button>
                <button type="button" onClick={() => decidir(p.id, "negado")} className="rounded border border-slate-300 px-2 py-0.5 text-xs">
                  Negar
                </button>
              </li>
            ))}
          </ul>
          {erroPedido && (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {erroPedido}
            </p>
          )}
        </section>
      )}

      {admin && resumo.cargaPorVendedor && resumo.cargaPorVendedor.length > 0 && (
        <section aria-label="Carga por vendedor" className="mb-6 rounded-lg border bg-white p-4 text-sm shadow-sm">
          <h2 className="mb-2 font-semibold text-navy">Carga por vendedor (leads abertos)</h2>
          <table className="w-full max-w-lg text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Vendedor</th>
                <th className="py-1 text-right">Leads</th>
                <th className="py-1 text-right">Valor mensal estimado</th>
              </tr>
            </thead>
            <tbody>
              {resumo.cargaPorVendedor.map((v) => (
                <tr key={v.vendedor_id} className="border-t">
                  <td className="py-1">{v.vendedor_nome}</td>
                  <td className="py-1 text-right">{v.abertos}</td>
                  <td className="py-1 text-right">{formatarMoeda(v.valorCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="mb-3 flex gap-2" role="group" aria-label="Visão">
        <button type="button" aria-pressed={visao === "funil"} onClick={() => setVisao("funil")} className={`rounded px-3 py-1 text-sm ${visao === "funil" ? "bg-navy text-white" : "border border-slate-300"}`}>
          Funil
        </button>
        <button type="button" aria-pressed={visao === "lista"} onClick={() => setVisao("lista")} className={`rounded px-3 py-1 text-sm ${visao === "lista" ? "bg-navy text-white" : "border border-slate-300"}`}>
          Lista
        </button>
      </div>

      {visao === "lista" ? (
        <ListaLeads admin={admin} vendedores={vendedores} etapaInicial={etapaInicial} />
      ) : semLeads ? (
        <div className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-slate-600">
          <p className="font-medium">Nenhum lead ainda.</p>
          <p className="mt-1">Cadastre a primeira prefeitura que você está prospectando.</p>
          <Link href="/crm/novo" className="mt-3 inline-block rounded bg-navy px-4 py-2 text-white">
            Cadastrar lead
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Funil">
            {ETAPAS_ABERTAS.map((etapa) => {
              const daEtapa = funil[etapa];
              const coluna = resumo.porEtapa.find((e) => e.etapa === etapa)!;
              return (
                <section key={etapa} aria-label={`Etapa ${ROTULO_ETAPA[etapa]}`} className="rounded-lg bg-slate-100 p-2">
                  <h2 className="font-semibold text-navy">
                    {ROTULO_ETAPA[etapa]} <span className="text-sm font-normal text-slate-500">({coluna.quantidade})</span>
                  </h2>
                  <p className="mb-2 text-xs text-slate-500" data-testid={`soma-${etapa}`}>
                    {formatarMoeda(coluna.valorCentavos)}/mês
                  </p>
                  {daEtapa.length === 0 ? (
                    <p className="text-xs text-slate-400">Nenhum lead.</p>
                  ) : (
                    <ul className="space-y-2">
                      {daEtapa.map((l) => (
                        <CartaoLead key={l.id} lead={l} admin={admin} />
                      ))}
                    </ul>
                  )}
                  <VerTodos etapa={etapa} total={coluna.quantidade} mostrados={daEtapa.length} />
                </section>
              );
            })}
          </div>
          <details className="mt-4 rounded-lg border bg-white p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-navy">Perdidos ({total("perdido")})</summary>
            {perdidos.length === 0 ? (
              <p className="mt-2 text-slate-500">Nenhum lead perdido.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {perdidos.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/crm/${l.id}`} className="font-medium text-navy underline">
                      {l.municipio_nome} — {l.uf}
                    </Link>
                    <span className="text-xs text-slate-500">{l.motivo_perda ? ROTULO_MOTIVO_PERDA[l.motivo_perda as MotivoPerda] : ""}</span>
                    {admin && <span className="text-xs text-slate-500">· {l.vendedor_nome}</span>}
                    <MoverPara leadId={l.id} etapa={l.etapa} municipio={l.municipio_nome} />
                  </li>
                ))}
              </ul>
            )}
            <VerTodos etapa="perdido" total={total("perdido")} mostrados={perdidos.length} />
          </details>
        </>
      )}
    </main>
  );
}
