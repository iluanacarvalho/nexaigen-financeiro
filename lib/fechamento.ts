// FECHAMENTO (rodada 16-B1) — regras PURAS: prazos das tarefas, selos,
// rótulos, nome do cliente e a prévia "o que vai acontecer". Escrita:
// lib/fechamentoServico.ts (aceite e assinatura) e lib/tarefasServico.ts.
//
// FLUXO: aceite registrado no CRM (lead → 'ganho') → cliente em
// 'aguardando_assinatura' (SEM cobrança: sem data de início, fora de MRR,
// notas e alertas) + tarefa de CONTRATOS (gerar o contrato, colher a
// assinatura) → assinatura registrada (data + PDF) → cliente 'ativo' com
// data_inicio_contrato = data da assinatura + tarefa de IMPLANTAÇÃO →
// concluída pela pessoa de Implantação ou pela integração com o Educa.

import { somarDias } from "./estadoNota";
import { rotuloDoPlano } from "./planos";

/** Prazo da tarefa de assinatura: 5 dias CORRIDOS a partir do aceite (ou a data prevista de assinatura, se vier e for posterior). */
export const PRAZO_ASSINATURA_DIAS = 5;
/** Prazo da tarefa de implantação: 15 dias CORRIDOS a partir da assinatura registrada. */
export const PRAZO_IMPLANTACAO_DIAS = 15;

export const TIPOS_TAREFA = ["contrato_assinatura", "implantacao"] as const;
export type TipoTarefa = (typeof TIPOS_TAREFA)[number];
export const ROTULO_TIPO_TAREFA: Record<TipoTarefa, string> = {
  contrato_assinatura: "Contrato e assinatura",
  implantacao: "Implantação"
};
/** Qual papel cuida de cada tipo (o mesmo CHECK ck_tarefa_papel_do_tipo da 0017). */
export const PAPEL_DO_TIPO: Record<TipoTarefa, "contratos" | "implantacao"> = {
  contrato_assinatura: "contratos",
  implantacao: "implantacao"
};

export const STATUS_TAREFA = ["aberta", "em_andamento", "concluida", "cancelada"] as const;
export type StatusTarefa = (typeof STATUS_TAREFA)[number];
export const ROTULO_STATUS_TAREFA: Record<StatusTarefa, string> = {
  aberta: "Na fila",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  cancelada: "Cancelada"
};

export const ACOES_HISTORICO_TAREFA = ["criada", "assumida", "devolvida", "concluida", "cancelada", "prazo_alterado"] as const;
export const ROTULO_ACAO_TAREFA: Record<(typeof ACOES_HISTORICO_TAREFA)[number], string> = {
  criada: "Criada",
  assumida: "Assumida",
  devolvida: "Devolvida à fila",
  concluida: "Concluída",
  cancelada: "Cancelada",
  prazo_alterado: "Prazo alterado"
};

/** Prazo da tarefa de assinatura: hoje + 5, ou a data prevista de assinatura quando é posterior a isso. */
export function prazoAssinatura(hoje: string, dataPrevista: string | null): string {
  const padrao = somarDias(hoje, PRAZO_ASSINATURA_DIAS);
  return dataPrevista && dataPrevista > padrao ? dataPrevista : padrao;
}

export function prazoImplantacao(dataAssinatura: string): string {
  return somarDias(dataAssinatura, PRAZO_IMPLANTACAO_DIAS);
}

/** Selo da tarefa ABERTA/EM ANDAMENTO: atrasada (prazo antes de hoje), vence hoje, ou nada. */
export function seloTarefa(t: { status: string; prazo: string }, hoje: string): "atrasada" | "vence_hoje" | null {
  if (t.status !== "aberta" && t.status !== "em_andamento") return null;
  if (t.prazo < hoje) return "atrasada";
  if (t.prazo === hoje) return "vence_hoje";
  return null;
}

/** Nome do cliente criado no aceite (o mesmo padrão dos clientes que já existem). */
export function nomeDoCliente(municipio: string): string {
  return `Prefeitura Municipal de ${municipio}`;
}

/** Texto da prévia "Confira antes de confirmar" — o que vai acontecer. */
export function textoDoQueVaiAcontecer(d: { municipio: string; uf: string; plano: string }): string[] {
  return [
    `Será criado o cliente ${nomeDoCliente(d.municipio)} — ${d.uf}, AGUARDANDO ASSINATURA (sem cobrança até a assinatura).`,
    `O contrato será gerado a partir do modelo do plano ${rotuloDoPlano(d.plano)} (rascunho enquanto o modelo não for aprovado).`,
    `Uma tarefa vai para a pessoa de Contratos: gerar o contrato, colher a assinatura e registrar a data e o PDF assinado.`,
    `O lead passa para "Ganho". A cobrança e a vigência só começam na data da assinatura.`
  ];
}
