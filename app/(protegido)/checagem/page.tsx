"use client";

// Fila de Checagem — notas SEM atesto, pra alguém do time conferir no
// portal de cada prefeitura. Desde a rodada 08 não tem regra própria: a
// lista vem de GET /api/notas?situacao=aguardando_atesto (mesma listagem
// paginada da tela de Notas fiscais), o registro passa por
// POST /api/notas/[id]/verificar (que usa a mesma máquina de estados da
// tela de Notas, lib/estadoNota.ts) e o PDF pelo componente compartilhado
// components/PdfVersionado.tsx.

import { useEffect, useState } from "react";
import Paginacao from "@/components/Paginacao";
import PdfVersionado from "@/components/PdfVersionado";
import type { NotaListada } from "@/lib/tipos";

const POR_PAGINA = 25;

interface PaginaNotas {
  notas: NotaListada[];
  total: number;
}

async function buscarFila(pagina: number): Promise<PaginaNotas> {
  const res = await fetch(`/api/notas?situacao=aguardando_atesto&ordenar=data_emissao&direcao=asc&pagina=${pagina}&por_pagina=${POR_PAGINA}`);
  if (!res.ok) return { notas: [], total: 0 };
  return res.json();
}

export default function FilaChecagemPage() {
  const [dados, setDados] = useState<PaginaNotas>({ notas: [], total: 0 });
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [erroAcao, setErroAcao] = useState<{ id: string; mensagem: string } | null>(null);

  // Recarga depois de uma ação ou troca de página — chamada de event handler.
  async function carregar(paginaDesejada = pagina) {
    setCarregando(true);
    setDados(await buscarFila(paginaDesejada));
    setCarregando(false);
  }

  // Carga inicial: o estado só muda no callback da Promise (react-hooks/set-state-in-effect),
  // ignorado se a página desmontar antes da resposta chegar.
  useEffect(() => {
    let ativo = true;
    buscarFila(1).then((d) => {
      if (!ativo) return;
      setDados(d);
      setCarregando(false);
    });
    return () => {
      ativo = false;
    };
  }, []);

  async function registrar(notaId: string, resultado: "sem_atesto_ainda" | "atestada") {
    setErroAcao(null);
    const res = await fetch(`/api/notas/${notaId}/verificar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resultado })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErroAcao({ id: notaId, mensagem: data?.erro ?? "Não foi possível registrar." });
      return;
    }
    carregar();
  }

  function mudarPagina(nova: number) {
    setPagina(nova);
    carregar(nova);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-2 text-2xl font-bold text-navy">Fila de Checagem — Atesto</h1>
      <p className="mb-6 text-sm text-slate-500">
        Notas emitidas sem atesto registrado ainda. Abra o portal de cada prefeitura, confira o status e registre o
        que encontrou — leva alguns segundos por nota. Pagamento, cancelamento e o histórico completo ficam em{" "}
        <a href="/notas" className="text-teal underline">
          Notas fiscais
        </a>
        .
      </p>

      {carregando && <p className="text-sm text-slate-400">Carregando...</p>}

      <div className="space-y-3">
        {dados.notas.map((n) => (
          <div key={n.id} className="flex items-start justify-between gap-4 rounded-lg border bg-white p-4 shadow-sm">
            <div>
              <p className="font-semibold text-navy">
                {n.cliente.nome} — {n.cliente.uf}
              </p>
              <p className="text-sm text-slate-500">
                NF {n.numero_nf ?? "—"} · {Number(n.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · emitida em{" "}
                {n.data_emissao} · sistema: {n.cliente.sistema_portal ?? "—"}
              </p>
              {n.cliente.portal_url && (
                <a href={n.cliente.portal_url} target="_blank" rel="noreferrer" className="text-sm text-teal underline">
                  Abrir portal da prefeitura →
                </a>
              )}
              <div className="mt-1">
                <PdfVersionado
                  urlArquivo={`/api/notas/${n.id}/arquivo`}
                  rotulo="nota fiscal"
                  versaoAtual={n.arquivo_pdf_versao_atual}
                  nomeAtual={n.arquivo_pdf_nome}
                  onEnviado={() => carregar()}
                />
              </div>
              {erroAcao?.id === n.id && <p className="mt-1 text-xs text-red-600">{erroAcao.mensagem}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => registrar(n.id, "sem_atesto_ainda")}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Ainda sem atesto
              </button>
              <button type="button" onClick={() => registrar(n.id, "atestada")} className="rounded bg-teal px-3 py-1.5 text-sm text-white hover:opacity-90">
                Atestada hoje
              </button>
            </div>
          </div>
        ))}
        {!carregando && dados.notas.length === 0 && (
          <p className="rounded-lg border bg-white p-6 text-center text-sm text-slate-400">Nenhuma nota pendente de checagem. 🎉</p>
        )}
      </div>

      <Paginacao pagina={pagina} porPagina={POR_PAGINA} total={dados.total} onMudar={mudarPagina} />
    </main>
  );
}
