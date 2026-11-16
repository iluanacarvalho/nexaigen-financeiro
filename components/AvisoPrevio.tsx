// Aviso de contrato com cancelamento registrado (rodada 12-A) — tela de
// Clientes e tela de Notas: "Contrato em aviso prévio — término em
// DD/MM/AAAA" (ou encerrado) e, enquanto a nota do último período não
// existir, o valor proporcional e o botão "Criar nota final". Em Clientes
// o botão leva a /notas?nota_final=<id>; em Notas abre o formulário ali
// mesmo (onCriarNotaFinal). Valores: lib/cancelamentoContrato.ts (as
// mesmas funções que o servidor usa).

import { centavosParaTextoCampo, formatarMoeda, paraCentavos } from "@/lib/dinheiro";
import { formatarDataBr, precisaNotaFinal, sugerirNotaFinal } from "@/lib/cancelamentoContrato";
import type { ClientePrefeitura } from "@/lib/tipos";

const mesAno = (competencia: string) => `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;

/** Mostrar aviso: contrato em aviso prévio, ou encerrado por ele ainda sem a nota final. */
export function mostrarAvisoContrato(c: ClientePrefeitura): boolean {
  return c.status_contrato === "em_aviso_previo" || precisaNotaFinal(c);
}

export function AvisoContrato({ cliente, onCriarNotaFinal }: { cliente: ClientePrefeitura; onCriarNotaFinal?: () => void }) {
  const termino = cliente.cancelamento_termino_em;
  if (!termino || (cliente.status_contrato !== "em_aviso_previo" && cliente.status_contrato !== "encerrado")) return null;
  const sugestao = sugerirNotaFinal({ data_inicio_contrato: cliente.data_inicio_contrato, cancelamento_termino_em: termino, valorMensalCentavos: paraCentavos(cliente.valor_mensal) });
  return (
    <div role="status" aria-label="Aviso prévio" className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
      <p className="font-medium">
        {cliente.status_contrato === "em_aviso_previo"
          ? `Contrato em aviso prévio — término em ${formatarDataBr(termino)}`
          : `Contrato encerrado — aviso prévio terminou em ${formatarDataBr(termino)}`}
      </p>
      {precisaNotaFinal(cliente) && (
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <span>
            Nota final: {formatarMoeda(sugestao.valorCentavos)} ({sugestao.dias} {sugestao.dias === 1 ? "dia" : "dias"}, competência {mesAno(sugestao.competencia)})
          </span>
          {onCriarNotaFinal ? (
            <button type="button" onClick={onCriarNotaFinal} className="rounded border border-amber-400 bg-white px-2 py-0.5 text-amber-900">
              Criar nota final
            </button>
          ) : (
            <a href={`/notas?nota_final=${cliente.id}`} className="rounded border border-amber-400 bg-white px-2 py-0.5 text-amber-900">
              Criar nota final
            </a>
          )}
        </p>
      )}
    </div>
  );
}

/** Formulário de nota já preenchido pra nota final (tela de Notas). */
export function inicialNotaFinal(c: ClientePrefeitura): { clienteId: string; valor: string; competencia: string; dias: number; periodo: { inicio: string; fim: string } } {
  const s = sugerirNotaFinal({ data_inicio_contrato: c.data_inicio_contrato, cancelamento_termino_em: c.cancelamento_termino_em!, valorMensalCentavos: paraCentavos(c.valor_mensal) });
  return { clienteId: c.id, valor: centavosParaTextoCampo(s.valorCentavos), competencia: s.competencia.slice(0, 7), dias: s.dias, periodo: s.periodo };
}
