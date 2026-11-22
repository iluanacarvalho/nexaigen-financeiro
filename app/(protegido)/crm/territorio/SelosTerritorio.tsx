// Selos do Território (rodada 16-A2): status comercial e plano efetivo com
// TEXTO e cor (nunca só cor), a etiqueta de ORIGEM do plano e a legenda
// sempre visível. Regras: lib/territorio.ts.

import { rotuloStatusContrato } from "@/lib/cancelamentoContrato";
import { ROTULO_ETAPA } from "@/lib/crm";
import {
  AVISO_PLANO_DIFERENTE,
  ROTULO_ORIGEM_PLANO,
  ROTULO_STATUS_COMERCIAL,
  STATUS_COMERCIAIS,
  rotuloPlanoEfetivo,
  type LinhaTerritorio,
  type OrigemPlano,
  type PlanoEfetivo,
  type StatusComercial
} from "@/lib/territorio";

export const COR_STATUS: Record<StatusComercial, string> = {
  cliente: "bg-emerald-100 text-emerald-900 border-emerald-300",
  em_fechamento: "bg-indigo-50 text-indigo-900 border-indigo-300",
  em_negociacao: "bg-blue-100 text-blue-900 border-blue-300",
  perdido: "bg-red-50 text-red-800 border-red-200",
  ex_cliente: "bg-sky-50 text-sky-900 border-sky-200",
  nao_abordado: "bg-white text-slate-700 border-slate-300"
};

const DESCRICAO_STATUS: Record<StatusComercial, string> = {
  cliente: "contrato vigente (ativo, em aviso prévio ou suspenso)",
  em_fechamento: "aceite registrado, contrato aguardando assinatura",
  em_negociacao: "tem lead aberto",
  perdido: "o último lead foi perdido",
  ex_cliente: "todos os contratos estão encerrados",
  nao_abordado: "nenhum lead ainda"
};

const COR_ORIGEM: Record<OrigemPlano, string> = {
  contratado: "bg-emerald-50 text-emerald-800",
  interesse: "bg-blue-50 text-blue-800",
  sugerido: "bg-slate-100 text-slate-600 italic",
  sem_plano: "bg-slate-100 text-slate-500"
};

const dataBr = (dia: string) => dia.split("-").reverse().join("/");

export function SeloStatus({ linha }: { linha: Pick<LinhaTerritorio, "status" | "contrato" | "lead" | "ex_cliente_encerrado_em"> }) {
  let detalhe = "";
  if (linha.status === "cliente" && linha.contrato) detalhe = ` — ${rotuloStatusContrato(linha.contrato.situacao).toLowerCase()}`;
  else if (linha.status === "em_negociacao" && linha.lead) detalhe = ` — ${ROTULO_ETAPA[linha.lead.etapa]}`;
  else if (linha.status === "ex_cliente") detalhe = linha.ex_cliente_encerrado_em ? ` — encerrado em ${dataBr(linha.ex_cliente_encerrado_em)}` : "";
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${COR_STATUS[linha.status]}`} data-testid="selo-status">
      {ROTULO_STATUS_COMERCIAL[linha.status]}
      {detalhe}
    </span>
  );
}

export function SeloPlano({ plano }: { plano: PlanoEfetivo }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="font-medium text-slate-800">{rotuloPlanoEfetivo(plano)}</span>
      {plano.origem !== "sem_plano" && (
        <span className={`rounded px-1.5 py-0.5 text-[11px] ${COR_ORIGEM[plano.origem]}`} data-testid="origem-plano">
          {ROTULO_ORIGEM_PLANO[plano.origem]}
        </span>
      )}
      {plano.divergente && (
        <span className="text-[11px] text-amber-700" data-testid="aviso-plano-diferente">
          ⚠ {AVISO_PLANO_DIFERENTE}
        </span>
      )}
    </span>
  );
}

/** Legenda SEMPRE visível (status e origem do plano). */
export function Legenda() {
  return (
    <section aria-label="Legenda" className="mb-3 rounded-lg border bg-white p-3 text-xs text-slate-600">
      <p className="mb-1 font-semibold text-slate-700">Legenda</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {STATUS_COMERCIAIS.map((s) => (
          <li key={s} className="flex items-center gap-1">
            <span className={`rounded border px-1.5 py-0.5 font-semibold ${COR_STATUS[s]}`}>{ROTULO_STATUS_COMERCIAL[s]}</span> {DESCRICAO_STATUS[s]}
          </li>
        ))}
      </ul>
      <p className="mt-1">
        Plano: <span className={`rounded px-1 ${COR_ORIGEM.contratado}`}>contratado</span> (cliente) ·{" "}
        <span className={`rounded px-1 ${COR_ORIGEM.interesse}`}>de interesse</span> (lead aberto) ·{" "}
        <span className={`rounded px-1 ${COR_ORIGEM.sugerido}`}>sugerido pela população</span> (faixas dos planos) · sem população: &quot;sem plano definido&quot;.
      </p>
    </section>
  );
}
