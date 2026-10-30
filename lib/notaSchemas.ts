// Schemas Zod das rotas de notas fiscais (rodada 08). Validação de FORMA
// aqui; regras de negócio (datas no passado, competência razoável, valor
// sem float, transições) em lib/estadoNota.ts — os refinamentos abaixo só
// chamam aquelas funções, nunca reimplementam a regra.

import { z } from "zod";
import { COLUNAS_ORDENACAO } from "./notasServico";
import { SITUACOES, normalizarCompetencia } from "./estadoNota";

export const POR_PAGINA_MAXIMO = 100;

/** Query string de GET /api/notas. Parâmetro desconhecido → 400 (`.strict()`), nunca ignorado em silêncio. */
export const FiltrosNotasSchema = z
  .object({
    situacao: z.enum(SITUACOES as [string, ...string[]]).optional(),
    cliente_id: z.string().uuid().optional(),
    competencia: z
      .string()
      .regex(/^\d{4}-\d{2}$/, "Use aaaa-mm.")
      .refine((v) => normalizarCompetencia(v) !== null, "Mês inválido.")
      .optional(),
    busca: z.string().trim().min(1).max(60).optional(),
    ordenar: z.enum(COLUNAS_ORDENACAO).default("data_emissao"),
    direcao: z.enum(["asc", "desc"]).default("desc"),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
    por_pagina: z.coerce.number().int().min(1).max(POR_PAGINA_MAXIMO).default(25)
  })
  .strict();

/**
 * Corpo de POST /api/notas. `valor` é TEXTO de propósito ("1500,50") —
 * number no JSON passaria por ponto flutuante antes de chegar aqui; um
 * `valor` numérico é recusado (400), nunca convertido.
 */
export const NovaNotaSchema = z
  .object({
    cliente_id: z.string().uuid(),
    competencia: z.string().min(7).max(10),
    numero_nf: z
      .string()
      .trim()
      .max(60)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    valor: z.string().max(20),
    data_emissao: z.string().max(10).optional()
  })
  .strict();

export const AcaoNotaSchema = z
  .object({
    acao: z.enum(["registrar_atesto", "registrar_pagamento", "cancelar", "reabrir_pagamento"]),
    data: z.string().max(10).optional(),
    motivo: z.string().max(1000).optional()
  })
  .strict();
