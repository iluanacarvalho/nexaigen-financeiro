"use client";

// Seção "Divulgação pública" do cliente (rodada 15-B) — mapa público das
// prefeituras atendidas. Regra central: só aparece com AUTORIZAÇÃO POR
// ESCRITO da prefeitura. Aqui a equipe:
//   - grava o código IBGE ("Buscar posição": o servidor consulta o IBGE,
//     grava código + posição e devolve o nome/UF oficiais — divergência
//     com o cadastro só AVISA, não bloqueia; IBGE fora do ar = "posição
//     pendente");
//   - autoriza (com confirmação) ou revoga (com confirmação, avisando que
//     sai do mapa em até 1 minuto) — PUT /api/clientes/[id]/divulgacao;
//   - vê quem autorizou e quando.
// O servidor revalida tudo (o banco também: CHECK da 0013).

import { useState } from "react";
import { situacaoDivulgacao, ROTULO_SITUACAO_DIVULGACAO } from "@/lib/mapaPublico";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import type { ClientePrefeitura } from "@/lib/tipos";

export const TEXTO_AUTORIZACAO =
  "Marque somente com autorização por escrito da prefeitura (cláusula de divulgação no contrato). O mapa mostra apenas nome, UF e posição aproximada do município.";

interface RespostaCodigo {
  codigoIbge: string | null;
  posicao: { lat: number; lon: number } | null;
  ibge: { status: "ok"; nome: string; uf: string } | { status: "indisponivel"; ufDoCodigo: string | null } | null;
  confere: boolean | null;
}

async function enviar(clienteId: string, corpo: object): Promise<{ ok: true; dados: RespostaCodigo } | { ok: false; erro: string }> {
  const res = await fetch(`/api/clientes/${clienteId}/divulgacao`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  const dados = await res.json().catch(() => null);
  if (res.ok) return { ok: true, dados };
  const detalhe = dados?.detalhes ? [...(dados.detalhes.formErrors ?? []), ...Object.values(dados.detalhes.fieldErrors ?? {}).flat()].join(" ") : "";
  return { ok: false, erro: detalhe || dados?.erro || "Não foi possível salvar." };
}

const formatarPosicao = (lat: string | number, lon: string | number) => `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;

export default function DivulgacaoPublica({ cliente, onAlterado }: { cliente: ClientePrefeitura; onAlterado: () => void }) {
  const [codigo, setCodigo] = useState(cliente.codigo_ibge ?? "");
  const [resultado, setResultado] = useState<RespostaCodigo | null>(null);
  const [confirmando, setConfirmando] = useState<"autorizar" | "revogar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const situacao = situacaoDivulgacao(cliente, hojeEmSaoPaulo(new Date()));
  const temPosicao = cliente.latitude !== null && cliente.longitude !== null;

  async function buscarPosicao() {
    setErro(null);
    setResultado(null);
    setEnviando(true);
    const r = await enviar(cliente.id, { acao: "definir_codigo", codigoIbge: codigo.trim() === "" ? null : codigo.trim() });
    setEnviando(false);
    if (!r.ok) return setErro(r.erro);
    setResultado(r.dados);
    onAlterado();
  }

  async function confirmar() {
    if (!confirmando) return;
    setErro(null);
    setEnviando(true);
    const r = await enviar(cliente.id, { acao: confirmando });
    setEnviando(false);
    if (!r.ok) return setErro(r.erro);
    setConfirmando(null);
    onAlterado();
  }

  return (
    <section aria-label="Divulgação pública" className="mb-6 rounded-lg border bg-white p-6 text-sm shadow-sm">
      <h2 className="font-semibold text-navy">Divulgação pública — {cliente.nome}</h2>
      <p className="mb-3 text-xs text-slate-500">
        Mapa das prefeituras atendidas no site da NEXAIGEN. Situação: <strong data-testid="situacao-divulgacao">{ROTULO_SITUACAO_DIVULGACAO[situacao]}</strong>
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="font-medium text-slate-700">Código IBGE do município (7 dígitos)</span>
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 7))}
            inputMode="numeric"
            disabled={cliente.autorizacao_divulgacao || enviando}
            className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1 font-mono disabled:bg-slate-50"
          />
        </label>
        <button type="button" onClick={buscarPosicao} disabled={cliente.autorizacao_divulgacao || enviando} className="rounded bg-navy px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {enviando && !confirmando ? "Buscando..." : "Buscar posição"}
        </button>
        <span className="text-xs text-slate-500">
          {cliente.autorizacao_divulgacao ? "Revogue a autorização para trocar o código." : "Consulta o IBGE e grava o código e a posição."}
        </span>
      </div>

      {resultado?.ibge?.status === "ok" && (
        <p className="mt-2 text-xs text-slate-700" role="status">
          IBGE: <strong>{resultado.ibge.nome} — {resultado.ibge.uf}</strong>
          {resultado.posicao ? ` · posição ${formatarPosicao(resultado.posicao.lat, resultado.posicao.lon)}` : " · posição pendente (malha do município indisponível no IBGE)"}
        </p>
      )}
      {resultado?.ibge?.status === "indisponivel" && (
        <p className="mt-2 text-xs text-amber-800" role="status">
          IBGE indisponível agora — o código foi salvo com a posição pendente. Tente &quot;Buscar posição&quot; de novo mais tarde.
        </p>
      )}
      {resultado?.confere === false && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900" role="alert">
          Atenção: o código não parece ser de {cliente.nome} — {cliente.uf}
          {resultado.ibge?.status === "ok" ? ` (o IBGE diz ${resultado.ibge.nome} — ${resultado.ibge.uf})` : ""}. Confira antes de autorizar.
        </p>
      )}
      {!resultado && cliente.codigo_ibge && (
        <p className="mt-2 text-xs text-slate-600">{temPosicao ? `Posição gravada: ${formatarPosicao(cliente.latitude!, cliente.longitude!)}` : "Posição pendente — clique em \"Buscar posição\"."}</p>
      )}

      <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            role="switch"
            checked={cliente.autorizacao_divulgacao}
            disabled={enviando || confirmando !== null || (!cliente.autorizacao_divulgacao && !temPosicao)}
            onChange={() => setConfirmando(cliente.autorizacao_divulgacao ? "revogar" : "autorizar")}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-slate-800">Autorizado a aparecer no mapa público</span>
            <span className="block text-xs text-slate-600">{TEXTO_AUTORIZACAO}</span>
            {!cliente.autorizacao_divulgacao && !temPosicao && <span className="block text-xs text-amber-800">Precisa de código IBGE e posição antes de autorizar.</span>}
          </span>
        </label>
        {cliente.autorizacao_divulgacao && cliente.autorizacao_divulgacao_em && (
          <p className="mt-2 text-xs text-slate-600">
            Autorizado por {cliente.autorizacao_divulgacao_por_nome ?? "—"} em{" "}
            {new Date(cliente.autorizacao_divulgacao_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}.
          </p>
        )}
      </div>

      {confirmando && (
        <div role="dialog" aria-label={confirmando === "autorizar" ? "Confirmar autorização" : "Confirmar revogação"} className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-slate-800">
            {confirmando === "autorizar"
              ? `Autorizar ${cliente.nome} a aparecer no mapa público? Confirme que existe autorização por escrito da prefeitura. Aparecem só o nome, a UF e a posição aproximada.`
              : `Revogar a autorização de ${cliente.nome}? A prefeitura sai do mapa público em até 1 minuto.`}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={confirmar} disabled={enviando} className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {enviando ? "Salvando..." : confirmando === "autorizar" ? "Confirmar autorização" : "Confirmar revogação"}
            </button>
            <button type="button" onClick={() => setConfirmando(null)} disabled={enviando} className="rounded border border-slate-300 px-3 py-1.5 text-xs">
              Voltar
            </button>
          </div>
        </div>
      )}
      {erro && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {erro}
        </p>
      )}
    </section>
  );
}
