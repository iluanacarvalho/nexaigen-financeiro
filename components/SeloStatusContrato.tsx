// Selo do status do contrato com rótulo em português (rodada 12-A) —
// tela de Clientes e tabela do Painel. Rótulos: lib/cancelamentoContrato.ts.

import { rotuloStatusContrato } from "@/lib/cancelamentoContrato";

const COR: Record<string, string> = {
  aguardando_assinatura: "bg-indigo-50 text-indigo-800",
  ativo: "bg-emerald-50 text-emerald-700",
  em_aviso_previo: "bg-amber-100 text-amber-800",
  suspenso: "bg-slate-100 text-slate-600",
  encerrado: "bg-slate-200 text-slate-600"
};

export default function SeloStatusContrato({ status }: { status: string }) {
  return (
    <span data-testid="selo-status-contrato" className={`rounded px-2 py-0.5 text-xs font-medium ${COR[status] ?? "bg-slate-100 text-slate-600"}`}>
      {rotuloStatusContrato(status)}
    </span>
  );
}
