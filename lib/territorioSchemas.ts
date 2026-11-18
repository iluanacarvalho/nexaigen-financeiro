// Schemas Zod das rotas do Território, do lote e das visões salvas (rodada
// 16-A2) — objetos estritos (chave desconhecida → 400). Os filtros de tela
// em si são lidos por lib/territorio.ts#lerFiltrosTerritorio, que NUNCA
// recusa (link compartilhável não quebra: valor inválido vira aviso).

import { z } from "zod";
import { codigoIbgeValido } from "./ibge";
import { LIMITE_LOTE, PARAMETROS_POR_TELA, TELAS_VISAO } from "./territorio";

/** Filtros como parâmetros de URL (texto → texto), poucos e curtos. */
const parametros = z
  .record(z.string().max(40), z.string().max(300))
  .refine((v) => Object.keys(v).length <= 30, { error: "Filtros demais." });

const codigos = z
  .array(z.string().refine(codigoIbgeValido, { error: "Código IBGE inválido (7 dígitos)." }))
  .min(1, { error: "Selecione ao menos uma prefeitura." })
  .max(LIMITE_LOTE, { error: `No máximo ${LIMITE_LOTE} prefeituras por lote.` });

export const LoteSchema = z.strictObject({
  acao: z.enum(["previa", "criar"], { error: "acao inválida — use previa ou criar." }),
  alvo: z.discriminatedUnion(
    "modo",
    [
      z.strictObject({ modo: z.literal("selecao"), codigos }),
      z.strictObject({ modo: z.literal("nao_abordados"), filtros: parametros.default({}), entidade_id: z.uuid({ error: "entidade_id inválido." }).optional() })
    ],
    { error: "alvo inválido — use modo selecao (com codigos) ou nao_abordados (com filtros)." }
  ),
  /** Só admin escolhe outro vendedor (o serviço recusa pra vendas). */
  vendedor_id: z.uuid({ error: "vendedor_id inválido." }).optional()
});

export const NovaVisaoSchema = z
  .strictObject({
    nome: z.string().trim().min(1, { error: "Dê um nome à visão." }).max(80, { error: "Até 80 caracteres." }),
    tela: z.enum(TELAS_VISAO, { error: `tela inválida — use: ${TELAS_VISAO.join(", ")}.` }),
    filtros: parametros
  })
  .superRefine((v, ctx) => {
    const desconhecidos = Object.keys(v.filtros).filter((k) => !PARAMETROS_POR_TELA[v.tela].includes(k));
    if (desconhecidos.length) ctx.addIssue({ code: "custom", path: ["filtros"], message: `Filtros desconhecidos para esta tela: ${desconhecidos.join(", ")}.` });
  });

export const ListarVisoesSchema = z.strictObject({ tela: z.enum(TELAS_VISAO, { error: "tela inválida." }).optional() });

export const BuscaGlobalSchema = z.strictObject({ q: z.string().trim().min(2, { error: "Digite ao menos 2 letras." }).max(60) });

export const ExportarTerritorioFormatoSchema = z.enum(["csv", "xlsx"], { error: "formato inválido — use csv ou xlsx." });
