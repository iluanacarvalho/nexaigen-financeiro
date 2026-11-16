// Schemas Zod das rotas de notas fiscais (rodada 08). Validação de FORMA
// aqui; regras de negócio (datas no passado, competência razoável, valor
// sem float, transições) em lib/estadoNota.ts — os refinamentos abaixo só
// chamam aquelas funções, nunca reimplementam a regra.

import { z } from "zod";
import { COLUNAS_ORDENACAO } from "./notasServico";
import { SITUACOES, normalizarCompetencia } from "./estadoNota";

export const POR_PAGINA_MAXIMO = 100;
export const TIPOS_NOTA = ["mensalidade", "implantacao"] as const;

/** Query string de GET /api/notas. Parâmetro desconhecido → 400 (objeto estrito), nunca ignorado em silêncio. */
export const FiltrosNotasSchema = z.strictObject({
    situacao: z.enum(SITUACOES).optional(),
    tipo: z.enum(TIPOS_NOTA).optional(),
    cliente_id: z.uuid().optional(),
    competencia: z
      .string()
      .regex(/^\d{4}-\d{2}$/, { error: "Use aaaa-mm." })
      .refine((v) => normalizarCompetencia(v) !== null, { error: "Mês inválido." })
      .optional(),
    busca: z.string().trim().min(1).max(60).optional(),
    ordenar: z.enum(COLUNAS_ORDENACAO).default("data_emissao"),
    direcao: z.enum(["asc", "desc"]).default("desc"),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
    por_pagina: z.coerce.number().int().min(1).max(POR_PAGINA_MAXIMO).default(25)
});

/**
 * Corpo de POST /api/notas. `valor` é TEXTO de propósito ("1500,50") —
 * number no JSON passaria por ponto flutuante antes de chegar aqui; um
 * `valor` numérico é recusado (400), nunca convertido.
 */
export const NovaNotaSchema = z.strictObject({
    cliente_id: z.uuid(),
    // Mensalidade (padrão) ou implantação (cobrança única da taxa combinada — rodada 11-A).
    tipo: z.enum(TIPOS_NOTA).default("mensalidade"),
    // Obrigatória na mensalidade; na implantação é SEMPRE o mês da emissão (a rota calcula —
    // se vier diferente, 400).
    competencia: z.string().min(7).max(10).optional(),
    numero_nf: z
      .string()
      .trim()
      .max(60)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    valor: z.string().max(20),
    data_emissao: z.string().max(10).optional()
});

export const AcaoNotaSchema = z.strictObject({
    acao: z.enum(["registrar_atesto", "registrar_pagamento", "cancelar", "reabrir_pagamento"]),
    data: z.string().max(10).optional(),
    motivo: z.string().max(1000).optional()
});
