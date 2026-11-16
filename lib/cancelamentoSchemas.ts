// Schemas Zod do cancelamento de contrato (rodada 12-A). Validação de
// FORMA aqui; as regras (data não futura, não antes do início, transição
// válida) ficam em lib/cancelamentoContrato.ts e são aplicadas pelo
// serviço, dentro da transação.

import { z } from "zod";
import { dataIsoValida } from "./estadoNota";
import { TAMANHO_MAXIMO_MOTIVO_CANCELAMENTO } from "./cancelamentoContrato";

const dataIso = (rotulo: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: `${rotulo}: use o formato aaaa-mm-dd.` })
    // Só confere o calendário quando o formato já está certo (senão seriam duas mensagens pro mesmo erro).
    .refine((v) => !/^\d{4}-\d{2}-\d{2}$/.test(v) || dataIsoValida(v), { error: `${rotulo}: data que não existe no calendário.` });

const motivo = z.string().trim().max(TAMANHO_MAXIMO_MOTIVO_CANCELAMENTO, { error: `Motivo muito longo — limite de ${TAMANHO_MAXIMO_MOTIVO_CANCELAMENTO} caracteres.` });

/** POST /api/clientes/[id]/cancelamento (tela de Clientes): data do ofício e motivo, os dois obrigatórios. */
export const RegistrarCancelamentoSchema = z.strictObject({
  dataPedido: dataIso("Data de recebimento do ofício"),
  motivo: motivo.min(1, { error: "Informe o motivo do cancelamento." })
});

export const ACOES_CANCELAMENTO_INTEGRACAO = ["registrar", "retratar", "encerrar"] as const;

/**
 * POST /api/integracao/clientes/[municipioIdExterno]/cancelamento (Educa).
 * registrar exige dataPedido; imediato só faz sentido em encerrar.
 */
export const CancelamentoIntegracaoSchema = z
  .strictObject({
    acao: z.enum(ACOES_CANCELAMENTO_INTEGRACAO, { error: `acao inválida — use: ${ACOES_CANCELAMENTO_INTEGRACAO.join(", ")}.` }),
    dataPedido: dataIso("dataPedido").optional(),
    motivo: motivo.optional(),
    imediato: z.boolean().optional()
  })
  .superRefine((v, ctx) => {
    if (v.acao === "registrar" && v.dataPedido === undefined) {
      ctx.addIssue({ code: "custom", message: "Informe dataPedido (data de recebimento do ofício) para registrar o cancelamento.", path: ["dataPedido"] });
    }
    if (v.acao !== "registrar" && v.dataPedido !== undefined) {
      ctx.addIssue({ code: "custom", message: "dataPedido só vale para acao 'registrar'.", path: ["dataPedido"] });
    }
    if (v.acao !== "encerrar" && v.imediato !== undefined) {
      ctx.addIssue({ code: "custom", message: "imediato só vale para acao 'encerrar'.", path: ["imediato"] });
    }
  });
