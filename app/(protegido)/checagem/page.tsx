"use client";

import { useEffect, useRef, useState } from "react";
import type { NotaComCliente, VersaoArquivoNota } from "@/lib/tipos";

const TAMANHO_MAXIMO_MOTIVO = 300; // mesmo limite validado no servidor (lib/versaoArquivo.ts)

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

function formatarTamanho(bytes: number | null): string {
  if (bytes === null) return "tamanho não registrado";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

type EstadoHistorico = { estado: "carregando" } | { estado: "erro" } | { estado: "pronto"; versoes: VersaoArquivoNota[] };

async function buscarNotasAguardandoAtesto(): Promise<NotaComCliente[]> {
  const res = await fetch("/api/notas?status=aguardando_atesto");
  const data = await res.json();
  return data.notas ?? [];
}

export default function FilaChecagemPage() {
  const [notas, setNotas] = useState<NotaComCliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [enviandoArquivoId, setEnviandoArquivoId] = useState<string | null>(null);
  const [erroArquivoId, setErroArquivoId] = useState<{ id: string; mensagem: string } | null>(null);
  const inputsArquivo = useRef<Record<string, HTMLInputElement | null>>({});
  // Substituição aguardando confirmação (nota que já tem PDF): nada é enviado antes do "Confirmar".
  const [substituicao, setSubstituicao] = useState<{ notaId: string; arquivo: File; motivo: string } | null>(null);
  const [historicos, setHistoricos] = useState<Record<string, EstadoHistorico>>({});

  // Recarga depois de uma ação (registrar/anexar) — chamada de event handler.
  async function carregar() {
    setCarregando(true);
    setNotas(await buscarNotasAguardandoAtesto());
    setCarregando(false);
  }

  // Carga inicial: o estado só muda no callback da Promise (nunca de forma
  // síncrona no corpo do efeito — react-hooks/set-state-in-effect), e é
  // ignorado se a página desmontar antes da resposta chegar.
  useEffect(() => {
    let ativo = true;
    buscarNotasAguardandoAtesto().then((lista) => {
      if (!ativo) return;
      setNotas(lista);
      setCarregando(false);
    });
    return () => {
      ativo = false;
    };
  }, []);

  async function registrar(notaId: string, resultado: string) {
    await fetch(`/api/notas/${notaId}/verificar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resultado })
    });
    carregar();
  }

  async function carregarHistorico(notaId: string) {
    setHistoricos((h) => ({ ...h, [notaId]: { estado: "carregando" } }));
    const res = await fetch(`/api/notas/${notaId}/arquivo/versoes`);
    if (!res.ok) {
      setHistoricos((h) => ({ ...h, [notaId]: { estado: "erro" } }));
      return;
    }
    const { versoes } = (await res.json()) as { versoes: VersaoArquivoNota[] };
    setHistoricos((h) => ({ ...h, [notaId]: { estado: "pronto", versoes } }));
  }

  function escolherArquivo(nota: NotaComCliente, arquivo: File) {
    setErroArquivoId(null);
    // Primeiro PDF: envia direto. Já existe um: pede confirmação (e motivo) antes.
    if (nota.arquivo_pdf_nome) setSubstituicao({ notaId: nota.id, arquivo, motivo: "" });
    else enviarArquivo(nota.id, arquivo, "");
  }

  async function enviarArquivo(notaId: string, arquivo: File, motivo: string) {
    setErroArquivoId(null);
    setEnviandoArquivoId(notaId);
    const formData = new FormData();
    formData.set("arquivo", arquivo);
    if (motivo.trim()) formData.set("motivo", motivo.trim());
    const res = await fetch(`/api/notas/${notaId}/arquivo`, { method: "POST", body: formData });
    setEnviandoArquivoId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErroArquivoId({ id: notaId, mensagem: data?.erro ?? "Não foi possível anexar o PDF." });
      return;
    }
    setSubstituicao(null);
    // Histórico já aberto/carregado fica desatualizado com a versão nova — recarrega.
    if (historicos[notaId]) carregarHistorico(notaId);
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
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {n.arquivo_pdf_nome ? (
                  <>
                    <a href={`/api/notas/${n.id}/arquivo`} download className="text-sm text-teal underline">
                      📄 Baixar nota fiscal
                    </a>
                    <span className="text-xs text-slate-500">
                      Versão atual: {n.arquivo_pdf_versao_atual ? `v${n.arquivo_pdf_versao_atual}` : "—"}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-slate-400">Sem PDF anexado</span>
                )}
                <input
                  ref={(el) => {
                    inputsArquivo.current[n.id] = el;
                  }}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const arquivo = e.target.files?.[0];
                    if (arquivo) escolherArquivo(n, arquivo);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => inputsArquivo.current[n.id]?.click()}
                  disabled={enviandoArquivoId === n.id || substituicao?.notaId === n.id}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {enviandoArquivoId === n.id ? "Enviando..." : n.arquivo_pdf_nome ? "Enviar nova versão" : "Anexar PDF"}
                </button>
              </div>

              {substituicao?.notaId === n.id && (
                <div className="mt-2 max-w-md rounded border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p className="text-slate-700">
                    Substituir o PDF atual
                    {n.arquivo_pdf_versao_atual ? ` (v${n.arquivo_pdf_versao_atual})` : ""} por <strong>{substituicao.arquivo.name}</strong>?
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    A versão anterior será mantida no histórico e continuará disponível para download — nada é apagado.
                  </p>
                  <label className="mt-2 block text-xs">
                    <span className="font-medium text-slate-700">Motivo da substituição (opcional)</span>
                    <textarea
                      value={substituicao.motivo}
                      maxLength={TAMANHO_MAXIMO_MOTIVO}
                      rows={2}
                      onChange={(e) => setSubstituicao({ ...substituicao, motivo: e.target.value })}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-teal focus:outline-none"
                    />
                    <span className="text-slate-400">
                      {substituicao.motivo.length}/{TAMANHO_MAXIMO_MOTIVO}
                    </span>
                  </label>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => enviarArquivo(n.id, substituicao.arquivo, substituicao.motivo)}
                      disabled={enviandoArquivoId === n.id}
                      className="rounded bg-teal px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {enviandoArquivoId === n.id ? "Enviando..." : "Confirmar e enviar nova versão"}
                    </button>
                    <button
                      onClick={() => setSubstituicao(null)}
                      disabled={enviandoArquivoId === n.id}
                      className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-white"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {n.arquivo_pdf_nome && (
                <details
                  className="mt-2 text-xs"
                  onToggle={(e) => {
                    if (e.currentTarget.open && !historicos[n.id]) carregarHistorico(n.id);
                  }}
                >
                  <summary className="cursor-pointer text-slate-500 hover:text-navy">Histórico de versões</summary>
                  <HistoricoVersoes notaId={n.id} historico={historicos[n.id]} onTentarDeNovo={() => carregarHistorico(n.id)} />
                </details>
              )}
              {erroArquivoId && erroArquivoId.id === n.id && <p className="mt-1 text-xs text-red-600">{erroArquivoId.mensagem}</p>}
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

function HistoricoVersoes({
  notaId,
  historico,
  onTentarDeNovo
}: {
  notaId: string;
  historico: EstadoHistorico | undefined;
  onTentarDeNovo: () => void;
}) {
  if (!historico || historico.estado === "carregando") return <p className="mt-1 text-slate-400">Carregando histórico...</p>;
  if (historico.estado === "erro") {
    return (
      <p className="mt-1 text-red-600">
        Não foi possível carregar o histórico.{" "}
        <button onClick={onTentarDeNovo} className="underline">
          Tentar de novo
        </button>
      </p>
    );
  }
  if (historico.versoes.length === 0) return <p className="mt-1 text-slate-400">Nenhuma versão registrada.</p>;

  return (
    <ol className="mt-1 space-y-1 border-l border-slate-200 pl-3">
      {historico.versoes.map((v) => (
        <li key={v.versao}>
          <span className="font-semibold text-navy">v{v.versao}</span>
          {v.atual && <span className="ml-1 rounded bg-teal/10 px-1 text-teal">atual</span>}{" "}
          <a href={`/api/notas/${notaId}/arquivo?versao=${v.versao}`} download className="text-teal underline">
            {v.nome}
          </a>
          <span className="text-slate-500">
            {" "}
            · {formatarDataHora(v.enviado_em)} · por {v.enviado_por_nome ?? "autor não registrado"} · {formatarTamanho(v.tamanho_bytes)}
          </span>
          {v.motivo && <p className="text-slate-600">Motivo: {v.motivo}</p>}
        </li>
      ))}
    </ol>
  );
}
