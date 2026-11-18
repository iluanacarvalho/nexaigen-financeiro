"use client";

// Detalhe do lead (rodada 16-A): dados (edição com controle de versão —
// 409 "alguém alterou este lead, recarregue"), próxima ação, "registrar
// contato" (tipo + texto, com o aviso de LGPD), mudar etapa ("Mover
// para…"), troca de vendedor (só admin) e a linha do tempo do histórico
// (mais recente primeiro). Toda ação recarrega os dados do servidor.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { centavosParaTextoCampo, formatarMoeda } from "@/lib/dinheiro";
import { AVISO_LGPD, ORIGENS, ROTULO_ETAPA, ROTULO_INTERACAO, ROTULO_MOTIVO_PERDA, ROTULO_ORIGEM, TIPOS_CONTATO, type MotivoPerda, type Origem, type TipoContato, type TipoInteracao } from "@/lib/crm";
import type { InteracaoLead, LeadListado } from "@/lib/crmRepositorio";
import { PLANOS, rotuloDoPlano } from "@/lib/planos";
import { UF_POR_CODIGO } from "@/lib/ibge";
import MoverPara from "../MoverPara";
import Selos from "../Selos";
import EtiquetasEntidades from "../EtiquetasEntidades";
import { SeloPlano } from "../territorio/SelosTerritorio";
import type { EntidadeEtiqueta } from "@/lib/territorio";

async function enviar(url: string, metodo: string, corpo: object): Promise<string | null> {
  const res = await fetch(url, { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  if (res.ok) return null;
  const d = await res.json().catch(() => null);
  const detalhes = d?.detalhes ? [...(d.detalhes.formErrors ?? []), ...Object.values(d.detalhes.fieldErrors ?? {}).flat()].join(" ") : "";
  return detalhes || d?.erro || "Não foi possível salvar.";
}

const UFS = Object.values(UF_POR_CODIGO).sort();
const dataBr = (dia: string | null) => (dia ? dia.split("-").reverse().join("/") : "—");
const instanteBr = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export function RegistrarContato({ leadId, onRegistrado }: { leadId: string; onRegistrado: () => void }) {
  const [tipo, setTipo] = useState<TipoContato>("ligacao");
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <form
      aria-label="Registrar contato"
      className="space-y-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        const falha = await enviar(`/api/leads/${leadId}/interacoes`, "POST", { tipo, texto });
        setEnviando(false);
        setErro(falha);
        if (!falha) {
          setTexto("");
          onRegistrado();
        }
      }}
    >
      <label className="block">
        <span className="font-medium text-slate-700">Tipo</span>
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoContato)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5">
          {TIPOS_CONTATO.map((t) => (
            <option key={t} value={t}>
              {ROTULO_INTERACAO[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="font-medium text-slate-700">O que aconteceu</span>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000} rows={3} required aria-describedby={`aviso-lgpd-${leadId}`} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
      </label>
      <p id={`aviso-lgpd-${leadId}`} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900" data-testid="aviso-lgpd">
        {AVISO_LGPD}
      </p>
      <button type="submit" disabled={enviando || texto.trim() === ""} className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
        {enviando ? "Salvando..." : "Registrar contato"}
      </button>
      {erro && (
        <p role="alert" className="text-xs text-red-600">
          {erro}
        </p>
      )}
    </form>
  );
}

export function LinhaDoTempo({ historico }: { historico: InteracaoLead[] }) {
  if (historico.length === 0) return <p className="text-sm text-slate-500">Nenhum registro ainda — registre o primeiro contato.</p>;
  return (
    <ol className="space-y-2 border-l border-slate-200 pl-3 text-sm" aria-label="Histórico do lead">
      {historico.map((h) => (
        <li key={h.id}>
          <p>
            <strong className="text-navy">{ROTULO_INTERACAO[h.tipo as TipoInteracao] ?? h.tipo}</strong>
            {h.etapa_anterior && h.etapa_nova && (
              <span>
                {" "}
                · {ROTULO_ETAPA[h.etapa_anterior as keyof typeof ROTULO_ETAPA]} → {ROTULO_ETAPA[h.etapa_nova as keyof typeof ROTULO_ETAPA]}
              </span>
            )}
            <span className="text-xs text-slate-500">
              {" "}
              · {instanteBr(h.em)} · {h.autor_nome}
            </span>
          </p>
          {h.texto && <p className="whitespace-pre-wrap text-slate-700">{h.texto}</p>}
        </li>
      ))}
    </ol>
  );
}

export default function DetalheLead({
  lead,
  historico,
  admin,
  vendedores,
  entidades = []
}: {
  lead: LeadListado;
  historico: InteracaoLead[];
  admin: boolean;
  vendedores: { id: string; nome: string }[];
  /** Entidades (associações/consórcios) do município — rodada 16-A2. */
  entidades?: EntidadeEtiqueta[];
}) {
  const router = useRouter();
  const recarregar = () => router.refresh();
  const [editando, setEditando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [acaoData, setAcaoData] = useState(lead.proxima_acao_em ?? "");
  const [acaoTexto, setAcaoTexto] = useState(lead.proxima_acao_descricao ?? "");
  const [novoVendedor, setNovoVendedor] = useState(lead.vendedor_id);

  async function salvarCampos(campos: object) {
    const falha = await enviar(`/api/leads/${lead.id}`, "PATCH", { versao: lead.versao, ...campos });
    setErro(falha);
    if (!falha) {
      setEditando(false);
      recarregar();
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-navy">
        {lead.municipio_nome} — {lead.uf}
      </h1>
      <p className="mb-1 text-sm text-slate-600">
        Etapa: <strong>{ROTULO_ETAPA[lead.etapa]}</strong> · Vendedor: {lead.vendedor_nome}
        {lead.motivo_perda && ` · Motivo da perda: ${ROTULO_MOTIVO_PERDA[lead.motivo_perda as MotivoPerda]}${lead.detalhe_perda ? ` (${lead.detalhe_perda})` : ""}`}
      </p>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Selos lead={lead} />
        <span className="text-xs text-slate-600">
          Plano: <SeloPlano plano={lead.plano_efetivo} />
        </span>
      </div>
      <div className="mb-4">
        <EtiquetasEntidades entidades={entidades} />
      </div>
      {erro && (
        <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-label="Dados do lead" className="rounded-lg border bg-white p-4 text-sm shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-navy">Dados</h2>
            <button type="button" onClick={() => setEditando(!editando)} className="text-xs text-navy underline">
              {editando ? "Cancelar" : "Editar"}
            </button>
          </div>
          {editando ? (
            <form
              aria-label="Editar lead"
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const t = (k: string) => String(fd.get(k) ?? "").trim();
                salvarCampos({
                  municipio_nome: t("municipio_nome"),
                  uf: t("uf"),
                  codigo_ibge: t("codigo_ibge") || null,
                  populacao: t("populacao") === "" ? null : Number(t("populacao")),
                  plano_interesse: t("plano_interesse") || null,
                  origem: t("origem"),
                  valor_mensal_estimado: t("valor") || null,
                  contato_nome: t("contato_nome") || null,
                  contato_cargo: t("contato_cargo") || null,
                  contato_email: t("contato_email") || null,
                  contato_telefone: t("contato_telefone") || null
                });
              }}
            >
              {[
                ["Município", "municipio_nome", lead.municipio_nome],
                ["Código IBGE", "codigo_ibge", lead.codigo_ibge ?? ""],
                ["Valor mensal estimado (R$)", "valor", lead.valor_mensal_estimado_centavos === null ? "" : centavosParaTextoCampo(lead.valor_mensal_estimado_centavos)],
                ["Contato", "contato_nome", lead.contato_nome ?? ""],
                ["Cargo", "contato_cargo", lead.contato_cargo ?? ""],
                ["E-mail", "contato_email", lead.contato_email ?? ""],
                ["Telefone", "contato_telefone", lead.contato_telefone ?? ""]
              ].map(([rotulo, nome, valor]) => (
                <label key={nome} className="block">
                  <span className="text-slate-600">{rotulo}</span>
                  <input name={nome} defaultValue={valor} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1" />
                </label>
              ))}
              <label className="block">
                <span className="text-slate-600">UF</span>
                <select name="uf" defaultValue={lead.uf} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1">
                  {UFS.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-slate-600">População</span>
                <input name="populacao" type="number" min={0} defaultValue={lead.populacao ?? ""} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1" />
              </label>
              <label className="block">
                <span className="text-slate-600">Plano de interesse</span>
                <select name="plano_interesse" defaultValue={lead.plano_interesse ?? ""} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1">
                  <option value="">Ainda não sabe</option>
                  {PLANOS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.rotulo}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-slate-600">Origem</span>
                <select name="origem" defaultValue={lead.origem} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1">
                  {ORIGENS.map((o) => (
                    <option key={o} value={o}>
                      {ROTULO_ORIGEM[o]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white">
                Salvar dados
              </button>
            </form>
          ) : (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <dt className="text-slate-500">Código IBGE</dt>
              <dd>{lead.codigo_ibge ?? "—"}</dd>
              <dt className="text-slate-500">População</dt>
              <dd>{lead.populacao?.toLocaleString("pt-BR") ?? "—"}</dd>
              <dt className="text-slate-500">Plano de interesse</dt>
              <dd>{lead.plano_interesse ? rotuloDoPlano(lead.plano_interesse) : "—"}</dd>
              <dt className="text-slate-500">Valor estimado</dt>
              <dd>{lead.valor_mensal_estimado_centavos === null ? "—" : `${formatarMoeda(lead.valor_mensal_estimado_centavos)}/mês`}</dd>
              <dt className="text-slate-500">Origem</dt>
              <dd>{ROTULO_ORIGEM[lead.origem as Origem] ?? lead.origem}</dd>
              <dt className="text-slate-500">Contato</dt>
              <dd>
                {[lead.contato_nome, lead.contato_cargo].filter(Boolean).join(" · ") || "—"}
                {lead.contato_email && <span className="block">{lead.contato_email}</span>}
                {lead.contato_telefone && <span className="block">{lead.contato_telefone}</span>}
              </dd>
            </dl>
          )}
        </section>

        <section aria-label="Próxima ação" className="rounded-lg border bg-white p-4 text-sm shadow-sm">
          <h2 className="mb-2 font-semibold text-navy">Próxima ação</h2>
          <p className="mb-2 text-slate-600">
            {lead.proxima_acao_em ? `${dataBr(lead.proxima_acao_em)}${lead.proxima_acao_descricao ? ` — ${lead.proxima_acao_descricao}` : ""}` : "Nenhuma definida."}
          </p>
          <form
            aria-label="Definir próxima ação"
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              salvarCampos({ proxima_acao_em: acaoData || null, proxima_acao_descricao: acaoData ? acaoTexto.trim() || null : null });
            }}
          >
            <label className="block">
              <span className="text-slate-600">Data</span>
              <input type="date" value={acaoData} onChange={(e) => setAcaoData(e.target.value)} className="mt-0.5 block rounded border border-slate-300 px-2 py-1" />
            </label>
            <label className="block flex-1">
              <span className="text-slate-600">O quê</span>
              <input value={acaoTexto} onChange={(e) => setAcaoTexto(e.target.value)} maxLength={300} className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1" />
            </label>
            <button type="submit" className="rounded bg-navy px-3 py-1.5 text-xs text-white">
              Salvar próxima ação
            </button>
          </form>

          <h2 className="mb-1 mt-4 font-semibold text-navy">Etapa</h2>
          <MoverPara leadId={lead.id} etapa={lead.etapa} municipio={lead.municipio_nome} />

          {admin && (
            <>
              <h2 className="mb-1 mt-4 font-semibold text-navy">Vendedor</h2>
              <form
                aria-label="Trocar vendedor"
                className="flex flex-wrap items-end gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const falha = await enviar(`/api/leads/${lead.id}/vendedor`, "POST", { vendedor_id: novoVendedor });
                  setErro(falha);
                  if (!falha) recarregar();
                }}
              >
                <label className="block">
                  <span className="sr-only">Novo vendedor</span>
                  <select value={novoVendedor} onChange={(e) => setNovoVendedor(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
                    {vendedores.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={novoVendedor === lead.vendedor_id} className="rounded border border-navy px-3 py-1 text-xs text-navy disabled:opacity-50">
                  Trocar vendedor
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section aria-label="Registrar contato" className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold text-navy">Registrar contato</h2>
          <RegistrarContato leadId={lead.id} onRegistrado={recarregar} />
        </section>
        <section aria-label="Linha do tempo" className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold text-navy">Linha do tempo</h2>
          <LinhaDoTempo historico={historico} />
        </section>
      </div>
    </main>
  );
}
