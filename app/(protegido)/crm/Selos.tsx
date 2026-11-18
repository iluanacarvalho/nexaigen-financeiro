// Selos do lead no CRM (rodada 16-A): "parado há N dias" (sem atividade há
// mais de 14 dias), "ação vencida" (próxima ação antes de hoje) e, desde a
// 16-A1, "ex-cliente" (o município já foi cliente e o contrato está
// encerrado — com a data do encerramento). Quem calcula é o servidor
// (lib/crm.ts / lib/crmRepositorio.ts, "hoje" em America/Sao_Paulo).

import type { LeadListado } from "@/lib/crmRepositorio";

export function textoExCliente(encerradoEm: string | null): string {
  return encerradoEm ? `ex-cliente · encerrado em ${encerradoEm.split("-").reverse().join("/")}` : "ex-cliente · data do encerramento não registrada";
}

export default function Selos({ lead }: { lead: Pick<LeadListado, "parado" | "acao_vencida" | "dias_sem_atividade" | "ex_cliente" | "ex_cliente_encerrado_em"> }) {
  return (
    <>
      {lead.ex_cliente && (
        <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800" data-testid="selo-ex-cliente">
          {textoExCliente(lead.ex_cliente_encerrado_em)}
        </span>
      )}
      {lead.parado && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800" data-testid="selo-parado">
          parado há {lead.dias_sem_atividade} dias
        </span>
      )}
      {lead.acao_vencida && (
        <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-alerta" data-testid="selo-acao-vencida">
          ação vencida
        </span>
      )}
    </>
  );
}
