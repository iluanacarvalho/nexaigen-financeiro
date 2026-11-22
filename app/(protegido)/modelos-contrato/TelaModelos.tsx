"use client";

// Tela dos modelos de contrato (rodada 16-B1, só admin): os 4 planos com as
// versões (rascunho/aprovado, quem e quando), "Editar" = nova versão em
// rascunho a partir da mais recente, pré-visualização com dados de EXEMPLO,
// a lista FECHADA de campos {{...}} e "Aprovar" com confirmação.

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CampoModelo } from "@/lib/contratoModelo";
import type { ModeloContrato } from "@/lib/modelosContratoServico";
import { IDS_PLANOS, rotuloDoPlano, type IdPlano } from "@/lib/planos";

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");

function Editor({ plano, base, onFechar }: { plano: IdPlano; base: ModeloContrato | undefined; onFechar: () => void }) {
  const router = useRouter();
  const [titulo, setTitulo] = useState(base?.titulo ?? `Contrato de prestação de serviços — ${rotuloDoPlano(plano)}`);
  const [conteudo, setConteudo] = useState(base?.conteudo ?? "");
  const [previa, setPrevia] = useState<{ texto: string; faixa: string | null; rodape: string } | null>(null);
  const [erros, setErros] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);

  async function previsualizar() {
    setErros([]);
    const res = await fetch("/api/modelos-contrato/previa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plano, conteudo }) });
    const d = await res.json().catch(() => null);
    if (!res.ok) return setErros(d?.detalhes?.fieldErrors?.conteudo ?? [d?.erro ?? "Não foi possível pré-visualizar."]);
    setPrevia(d);
  }
  async function salvar() {
    setSalvando(true);
    setErros([]);
    const res = await fetch("/api/modelos-contrato", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plano, titulo, conteudo }) });
    const d = await res.json().catch(() => null);
    setSalvando(false);
    if (!res.ok) return setErros(d?.detalhes?.fieldErrors?.conteudo ?? d?.detalhes?.fieldErrors?.titulo ?? [d?.erro ?? "Não foi possível salvar."]);
    onFechar();
    router.refresh();
  }
  return (
    <section aria-label={`Nova versão — ${rotuloDoPlano(plano)}`} className="mt-3 rounded border border-navy/30 bg-slate-50 p-3 text-sm">
      <p className="mb-2 text-xs text-slate-600">Salvar cria a versão {base ? base.versao + 1 : 1} em RASCUNHO. A versão {base?.versao ?? "—"} continua como está.</p>
      <label className="block">
        <span className="font-medium">Título</span>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
      </label>
      <label className="mt-2 block">
        <span className="font-medium">Texto do modelo</span>
        <textarea value={conteudo} onChange={(e) => setConteudo(e.target.value)} rows={16} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
      </label>
      {erros.length > 0 && (
        <ul role="alert" className="mt-2 text-red-700">
          {erros.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => void previsualizar()} className="rounded border border-navy px-3 py-1 text-navy">
          Pré-visualizar com dados de exemplo
        </button>
        <button type="button" onClick={() => void salvar()} disabled={salvando} className="rounded bg-navy px-3 py-1 text-white disabled:opacity-50">
          Salvar como nova versão (rascunho)
        </button>
        <button type="button" onClick={onFechar} className="rounded border border-slate-300 px-3 py-1">
          Cancelar
        </button>
      </div>
      {previa && (
        <div aria-label="Pré-visualização" className="mt-3 rounded border bg-white p-3">
          {previa.faixa && <p className="mb-2 text-center text-xs font-bold text-red-700">{previa.faixa}</p>}
          <pre className="whitespace-pre-wrap font-sans text-xs" data-testid="texto-previa">
            {previa.texto}
          </pre>
          <p className="mt-2 text-center text-[11px] text-slate-500">{previa.rodape}</p>
        </div>
      )}
    </section>
  );
}

function Aprovar({ modelo }: { modelo: ModeloContrato }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function aprovar() {
    const res = await fetch(`/api/modelos-contrato/${modelo.id}/aprovar`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!res.ok) return setErro((await res.json().catch(() => null))?.erro ?? "Não foi possível aprovar.");
    setConfirmando(false);
    router.refresh();
  }
  if (!confirmando)
    return (
      <button type="button" onClick={() => setConfirmando(true)} className="rounded bg-teal px-2 py-0.5 text-xs text-white">
        Aprovar
      </button>
    );
  return (
    <span role="dialog" aria-label="Confirmar aprovação" className="inline-flex flex-wrap items-center gap-2 rounded border border-teal bg-teal/5 px-2 py-1 text-xs">
      Aprovar a versão {modelo.versao} de {rotuloDoPlano(modelo.plano)}? Os contratos gerados passam a sair SEM a faixa de rascunho. Não dá para desfazer.
      <button type="button" onClick={() => void aprovar()} className="rounded bg-teal px-2 py-0.5 text-white">
        Confirmar aprovação
      </button>
      <button type="button" onClick={() => setConfirmando(false)} className="rounded border border-slate-300 px-2 py-0.5">
        Voltar
      </button>
      {erro && <span className="text-red-700">{erro}</span>}
    </span>
  );
}

export default function TelaModelos({ modelos, campos }: { modelos: ModeloContrato[]; campos: CampoModelo[] }) {
  const [editando, setEditando] = useState<IdPlano | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-4">
        {IDS_PLANOS.map((plano) => {
          const versoes = modelos.filter((m) => m.plano === plano);
          const aprovado = versoes.find((m) => m.status === "aprovado");
          return (
            <section key={plano} aria-label={`Plano ${rotuloDoPlano(plano)}`} className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-navy">{rotuloDoPlano(plano)}</h2>
                <span className="text-xs" data-testid={`situacao-${plano}`}>
                  {aprovado ? `Em uso: v${aprovado.versao} (aprovada)` : <span className="font-semibold text-red-700">Sem versão aprovada — contratos saem como RASCUNHO</span>}
                </span>
                <button type="button" onClick={() => setEditando(plano)} className="rounded border border-navy px-2 py-0.5 text-xs text-navy">
                  Editar (nova versão)
                </button>
              </div>
              <table className="mt-2 w-full text-xs">
                <caption className="sr-only">Versões do modelo {rotuloDoPlano(plano)}</caption>
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">Versão</th>
                    <th className="py-1">Título</th>
                    <th className="py-1">Situação</th>
                    <th className="py-1">Criada</th>
                    <th className="py-1">Aprovada</th>
                    <th className="py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {versoes.map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="py-1">v{m.versao}</td>
                      <td className="py-1">{m.titulo}</td>
                      <td className="py-1">
                        <span className={`rounded px-1.5 py-0.5 ${m.status === "aprovado" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`} data-testid="status-modelo">
                          {m.status === "aprovado" ? "Aprovado" : "Rascunho"}
                        </span>
                      </td>
                      <td className="py-1">
                        {quando(m.criado_em)}
                        {m.criado_por_nome ? ` · ${m.criado_por_nome}` : " · carga inicial"}
                      </td>
                      <td className="py-1">{m.aprovado_em ? `${quando(m.aprovado_em)} · ${m.aprovado_por_nome ?? "—"}` : "—"}</td>
                      <td className="py-1">{m.status === "rascunho" && <Aprovar modelo={m} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {editando === plano && <Editor plano={plano} base={versoes[0]} onFechar={() => setEditando(null)} />}
            </section>
          );
        })}
      </div>
      <aside aria-label="Campos disponíveis" className="h-fit rounded-lg border bg-white p-3 text-xs shadow-sm">
        <h2 className="mb-1 font-semibold text-navy">Campos disponíveis</h2>
        <p className="mb-2 text-slate-600">Escreva exatamente como abaixo. Campo fora da lista é recusado ao salvar. &quot;# &quot; = título, &quot;## &quot; = subtítulo, **negrito**, linha em branco = novo parágrafo.</p>
        <ul className="space-y-1">
          {campos.map((c) => (
            <li key={c.campo}>
              <code className="rounded bg-slate-100 px-1">{`{{${c.campo}}}`}</code> — {c.descricao}
              {c.obrigatorio ? "" : " (opcional)"}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
