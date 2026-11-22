"use client";

// Cancelamento de contrato na tela de Clientes (rodada 12-A). O aviso de
// "em aviso prévio" + "Criar nota final" é components/AvisoPrevio.tsx
// (compartilhado com a tela de Notas).
//   - PainelRegistrarCancelamento: data do ofício + motivo e, antes de
//     enviar, confirmação EXPLÍCITA mostrando o término calculado;
//   - PainelRetratarCancelamento: confirmação da retratação.
// O término e a nota final vêm das MESMAS funções puras que o servidor usa
// (lib/cancelamentoContrato.ts); o servidor revalida tudo na transação.

import { useState } from "react";
import { formatarDataBr, validarPedido, validarRetratacao, TAMANHO_MAXIMO_MOTIVO_CANCELAMENTO } from "@/lib/cancelamentoContrato";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import type { ClientePrefeitura } from "@/lib/tipos";

/** Pode registrar cancelamento (contrato ativo)? Pode retratar (em aviso e até o término)? */
export function acoesDeCancelamento(c: ClientePrefeitura, hoje: string): { registrar: boolean; retratar: boolean } {
  return {
    registrar: c.status_contrato === "ativo",
    retratar: validarRetratacao({ statusContrato: c.status_contrato, termino: c.cancelamento_termino_em, hoje }).ok
  };
}

async function lerErro(res: Response, padrao: string): Promise<string> {
  const d = await res.json().catch(() => null);
  const detalhes = d?.detalhes ? [...(d.detalhes.formErrors ?? []), ...Object.values(d.detalhes.fieldErrors ?? {}).flat()].join(" ") : "";
  return detalhes || d?.erro || padrao;
}

export function PainelRegistrarCancelamento({ cliente, onConcluido, onDesistir }: { cliente: ClientePrefeitura; onConcluido: () => void; onDesistir: () => void }) {
  const hoje = hojeEmSaoPaulo(new Date());
  const [dataPedido, setDataPedido] = useState(hoje);
  const [motivo, setMotivo] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Só aparece pra contrato ATIVO — que sempre tem data de início (CHECK da 0017: nula só aguardando assinatura).
  const inicio = cliente.data_inicio_contrato ?? "";
  const validacao = validarPedido({ dataPedido, hoje, dataInicioContrato: inicio, statusContrato: cliente.status_contrato });

  function continuar() {
    setErro(null);
    if (!validacao.ok) return setErro(validacao.erro);
    if (motivo.trim() === "") return setErro("Informe o motivo do cancelamento.");
    setConfirmando(true);
  }

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    const res = await fetch(`/api/clientes/${cliente.id}/cancelamento`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataPedido, motivo: motivo.trim() })
    });
    setEnviando(false);
    if (!res.ok) {
      setConfirmando(false);
      return setErro(await lerErro(res, "Não foi possível registrar o cancelamento."));
    }
    onConcluido();
  }

  return (
    <div role="dialog" aria-label="Registrar cancelamento" className="text-sm">
      {!confirmando ? (
        <>
          <p className="font-medium text-slate-800">Registrar cancelamento — {cliente.nome}</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs text-slate-700">Data de recebimento do ofício</span>
              <input
                type="date"
                value={dataPedido}
                max={hoje}
                min={inicio || undefined}
                onChange={(e) => setDataPedido(e.target.value)}
                className="mt-1 block rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="block w-full max-w-lg">
              <span className="text-xs text-slate-700">Motivo (obrigatório)</span>
              <textarea
                value={motivo}
                maxLength={TAMANHO_MAXIMO_MOTIVO_CANCELAMENTO}
                rows={2}
                onChange={(e) => setMotivo(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              />
              <span className="text-xs text-slate-400">
                {motivo.length}/{TAMANHO_MAXIMO_MOTIVO_CANCELAMENTO}
              </span>
            </label>
            <button type="button" onClick={continuar} className="rounded bg-navy px-3 py-1.5 text-xs font-medium text-white">
              Continuar
            </button>
            <button type="button" onClick={onDesistir} className="rounded border border-slate-300 px-3 py-1.5 text-xs">
              Voltar
            </button>
          </div>
        </>
      ) : (
        validacao.ok && (
          <>
            <p className="font-medium text-slate-800">
              Registrar o cancelamento do contrato de {cliente.nome}? Ofício recebido em {formatarDataBr(dataPedido)} → término em{" "}
              <strong>{formatarDataBr(validacao.termino)}</strong> (aviso prévio de 30 dias).
            </p>
            <p className="mt-1 text-xs text-slate-600">
              {validacao.termino < hoje
                ? "O término já passou — o contrato será ENCERRADO imediatamente."
                : "Até o término o contrato segue normal e a mensalidade continua devida (a última nota é proporcional). Retratação possível até o término."}{" "}
              Notas já emitidas continuam sendo cobradas normalmente.
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={confirmar} disabled={enviando} className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                {enviando ? "Salvando..." : "Confirmar cancelamento"}
              </button>
              <button type="button" onClick={() => setConfirmando(false)} disabled={enviando} className="rounded border border-slate-300 px-3 py-1.5 text-xs">
                Voltar
              </button>
            </div>
          </>
        )
      )}
      {erro && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {erro}
        </p>
      )}
    </div>
  );
}

export function PainelRetratarCancelamento({ cliente, onConcluido, onDesistir }: { cliente: ClientePrefeitura; onConcluido: () => void; onDesistir: () => void }) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    const res = await fetch(`/api/clientes/${cliente.id}/cancelamento`, { method: "DELETE" });
    setEnviando(false);
    if (!res.ok) return setErro(await lerErro(res, "Não foi possível retratar o cancelamento."));
    onConcluido();
  }

  return (
    <div role="dialog" aria-label="Retratar cancelamento" className="text-sm">
      <p className="font-medium text-slate-800">
        Retratar o cancelamento de {cliente.nome}? O contrato volta a ficar ativo (o aviso prévio terminaria em {formatarDataBr(cliente.cancelamento_termino_em!)}).
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={confirmar} disabled={enviando} className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {enviando ? "Salvando..." : "Confirmar retratação"}
        </button>
        <button type="button" onClick={onDesistir} disabled={enviando} className="rounded border border-slate-300 px-3 py-1.5 text-xs">
          Voltar
        </button>
      </div>
      {erro && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {erro}
        </p>
      )}
    </div>
  );
}
