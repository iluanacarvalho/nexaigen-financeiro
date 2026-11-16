"use client";

// PDF com histórico de versões — UM componente pras três telas que lidam
// com isso: Fila de Checagem e Notas fiscais (PDF da nota, 0005) e
// Clientes (contrato, 0009). As rotas por trás seguem o mesmo contrato
// (lib/versionamentoPdf.ts): POST `${urlArquivo}` (multipart arquivo +
// motivo), GET `${urlArquivo}[?versao=N]` (download pelo servidor),
// GET `${urlArquivo}/versoes`.
//
// - Download sempre por link real `<a href download>` (nunca um <button>
//   dentro de <a>, nunca fetch + window.open).
// - Primeiro envio: direto. Substituição: só depois de confirmar num painel
//   que diz que a versão anterior é MANTIDA, com motivo opcional (≤300).
// - Histórico carregado na primeira vez que é aberto (e recarregado depois
//   de cada envio, se já estava carregado).

import { useRef, useState } from "react";
import type { VersaoArquivoPdf } from "@/lib/tipos";

const TAMANHO_MAXIMO_MOTIVO = 300; // mesmo limite validado no servidor (lib/versaoArquivo.ts)

type EstadoHistorico = { estado: "carregando" } | { estado: "erro" } | { estado: "pronto"; versoes: VersaoArquivoPdf[] };

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

function formatarTamanho(bytes: number | null): string {
  if (bytes === null) return "tamanho não registrado";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

export default function PdfVersionado({
  urlArquivo,
  rotulo,
  versaoAtual,
  nomeAtual,
  onEnviado
}: {
  urlArquivo: string;
  /** Como o documento aparece no texto: "nota fiscal", "contrato". */
  rotulo: string;
  versaoAtual: number | null;
  nomeAtual: string | null;
  onEnviado: () => void;
}) {
  const inputArquivo = useRef<HTMLInputElement | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [substituicao, setSubstituicao] = useState<{ arquivo: File; motivo: string } | null>(null);
  const [historico, setHistorico] = useState<EstadoHistorico | null>(null);

  async function carregarHistorico() {
    setHistorico({ estado: "carregando" });
    const res = await fetch(`${urlArquivo}/versoes`);
    if (!res.ok) {
      setHistorico({ estado: "erro" });
      return;
    }
    const { versoes } = (await res.json()) as { versoes: VersaoArquivoPdf[] };
    setHistorico({ estado: "pronto", versoes });
  }

  async function enviar(arquivo: File, motivo: string) {
    setErro(null);
    setEnviando(true);
    const formData = new FormData();
    formData.set("arquivo", arquivo);
    if (motivo.trim()) formData.set("motivo", motivo.trim());
    const res = await fetch(urlArquivo, { method: "POST", body: formData });
    setEnviando(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErro(data?.erro ?? `Não foi possível enviar o ${rotulo}.`);
      return;
    }
    setSubstituicao(null);
    if (historico) carregarHistorico();
    onEnviado();
  }

  // Só PDF: confere extensão/tipo E os primeiros bytes ("%PDF-") antes de qualquer
  // envio. O servidor revalida (lib/validacaoPdf.ts) — isto só dá o aviso na hora.
  async function escolher(arquivo: File) {
    setErro(null);
    const pareceUmPdf = arquivo.type === "application/pdf" || arquivo.name.toLowerCase().endsWith(".pdf");
    if (!pareceUmPdf || (await arquivo.slice(0, 5).text()) !== "%PDF-") {
      setErro(`O ${rotulo} precisa ser um arquivo PDF (.pdf). Outros formatos, como Word ou imagem, não são aceitos.`);
      return;
    }
    if (nomeAtual) setSubstituicao({ arquivo, motivo: "" });
    else enviar(arquivo, "");
  }

  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {nomeAtual ? (
          <>
            <a href={urlArquivo} download className="text-teal underline">
              📄 Baixar {rotulo}
            </a>
            <span className="text-xs text-slate-500">Versão atual: {versaoAtual ? `v${versaoAtual}` : "—"}</span>
          </>
        ) : (
          <span className="text-slate-400">Sem {rotulo} anexado</span>
        )}
        <input
          ref={inputArquivo}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          aria-label={`Arquivo PDF do ${rotulo}`}
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) escolher(arquivo);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputArquivo.current?.click()}
          disabled={enviando || substituicao !== null}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {enviando ? "Enviando..." : nomeAtual ? "Enviar nova versão" : `Anexar ${rotulo}`}
        </button>
        <span className="text-xs text-slate-500">Somente PDF, até 10 MB.</span>
      </div>

      {substituicao && (
        <div role="dialog" aria-label={`Confirmar nova versão do ${rotulo}`} className="mt-2 max-w-md rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-slate-700">
            Substituir o {rotulo} atual{versaoAtual ? ` (v${versaoAtual})` : ""} por <strong>{substituicao.arquivo.name}</strong>?
          </p>
          <p className="mt-1 text-xs text-slate-600">A versão anterior será mantida no histórico e continuará disponível para download — nada é apagado.</p>
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
              type="button"
              onClick={() => enviar(substituicao.arquivo, substituicao.motivo)}
              disabled={enviando}
              className="rounded bg-teal px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {enviando ? "Enviando..." : "Confirmar e enviar nova versão"}
            </button>
            <button
              type="button"
              onClick={() => setSubstituicao(null)}
              disabled={enviando}
              className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {erro && <p className="mt-1 text-xs text-red-600">{erro}</p>}

      {nomeAtual && (
        <details
          className="mt-2 text-xs"
          onToggle={(e) => {
            if (e.currentTarget.open && !historico) carregarHistorico();
          }}
        >
          <summary className="cursor-pointer text-slate-500 hover:text-navy">Histórico de versões</summary>
          <ListaVersoes urlArquivo={urlArquivo} historico={historico} onTentarDeNovo={carregarHistorico} />
        </details>
      )}
    </div>
  );
}

function ListaVersoes({ urlArquivo, historico, onTentarDeNovo }: { urlArquivo: string; historico: EstadoHistorico | null; onTentarDeNovo: () => void }) {
  if (!historico || historico.estado === "carregando") return <p className="mt-1 text-slate-400">Carregando histórico...</p>;
  if (historico.estado === "erro") {
    return (
      <p className="mt-1 text-red-600">
        Não foi possível carregar o histórico.{" "}
        <button type="button" onClick={onTentarDeNovo} className="underline">
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
          <a href={`${urlArquivo}?versao=${v.versao}`} download className="text-teal underline">
            {v.nome}
          </a>
          <span className="text-slate-500">
            {" "}
            · {formatarDataHora(v.enviado_em)} · por {v.enviado_por_nome ?? "autor não registrado (integração ou anexo anterior ao histórico)"} ·{" "}
            {formatarTamanho(v.tamanho_bytes)}
          </span>
          {v.motivo && <p className="text-slate-600">Motivo: {v.motivo}</p>}
        </li>
      ))}
    </ol>
  );
}
