// Selos do lead no CRM (rodada 16-A): "parado há N dias" (sem atividade há
// mais de 14 dias) e "ação vencida" (próxima ação antes de hoje). Quem
// calcula é o servidor (lib/crm.ts, com "hoje" em America/Sao_Paulo).

import type { LeadListado } from "@/lib/crmRepositorio";

export default function Selos({ lead }: { lead: Pick<LeadListado, "parado" | "acao_vencida" | "dias_sem_atividade"> }) {
  return (
    <>
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
