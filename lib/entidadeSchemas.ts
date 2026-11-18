// Schemas Zod das entidades intermunicipais e do Território (rodada 16-A2)
// — validação de FORMA, objetos estritos. Os MESMOS campos valem pro CSV
// (lib/entidadesCsv.ts) e pra tela do admin (POST/PATCH /api/entidades):
// uma regra só. Fonte (URL http/https) e data de verificação obrigatórias.

import { z } from "zod";
import { dataIsoValida } from "./estadoNota";
import { codigoIbgeValido } from "./ibge";
import { TIPOS_ENTIDADE, UFS_BRASIL } from "./entidades";

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Até ${max} caracteres.` })
    .transform((v) => (v === "" ? null : v))
    .nullable();

const url = (max: number, obrigatoria: string | null) => {
  const base = z
    .string()
    .trim()
    .max(max, { error: `Até ${max} caracteres.` })
    .refine((v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+$/.test(v), { error: "Use um endereço que comece com http:// ou https://." });
  return obrigatoria
    ? base.refine((v) => v !== "", { error: obrigatoria })
    : base.transform((v) => (v === "" ? null : v)).nullable();
};

export const CAMPOS_ENTIDADE = {
  nome: z.string().trim().min(2, { error: "Informe o nome da entidade." }).max(200, { error: "Até 200 caracteres." }),
  sigla: textoOpcional(30),
  tipo: z.enum(TIPOS_ENTIDADE, { error: `Tipo inválido — use: ${TIPOS_ENTIDADE.join(", ")}.` }),
  uf: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v.toUpperCase()))
    .refine((v) => v === null || UFS_BRASIL.includes(v), { error: "UF inválida." })
    .nullable(),
  site: url(300, null),
  contato_nome: textoOpcional(200),
  contato_email: z
    .string()
    .trim()
    .max(254)
    .transform((v) => (v === "" ? null : v))
    .pipe(z.email({ error: "E-mail inválido." }).nullable())
    .nullable(),
  contato_telefone: textoOpcional(40),
  observacao: textoOpcional(1000),
  fonte_url: url(500, "Informe a fonte (endereço http/https de onde a informação foi conferida)."),
  verificado_em: z
    .string({ error: "Informe a data da verificação." })
    .refine((v) => v !== "", { error: "Informe a data da verificação." })
    .refine((v) => v === "" || dataIsoValida(v), { error: "Data inválida — use aaaa-mm-dd (ou dd/mm/aaaa no CSV)." })
};

/** Todos os campos (CSV e criação pela tela). verificado_em no futuro é barrado por quem chama (precisa de "hoje"). */
export const EntidadeCamposSchema = z.strictObject(CAMPOS_ENTIDADE);
export type EntidadeCampos = z.infer<typeof EntidadeCamposSchema>;

/** PATCH /api/entidades/[id]: qualquer subconjunto + ativo (desativar = "remover" sem apagar). */
export const EditarEntidadeSchema = z
  .strictObject({ ...CAMPOS_ENTIDADE, ativo: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: "Envie ao menos um campo para atualizar." });

const codigoIbge = z.string().trim().refine(codigoIbgeValido, { error: "O código IBGE do município tem exatamente 7 dígitos." });

export const MembroSchema = z.strictObject({
  codigo_ibge: codigoIbge,
  desde: z
    .string()
    .refine(dataIsoValida, { error: "Data inválida — use aaaa-mm-dd." })
    .nullable()
    .optional()
});
export const RemoverMembroSchema = z.strictObject({ codigo_ibge: codigoIbge });

export const LiberarEstadoSchema = z.strictObject({ liberado: z.boolean({ error: "Envie liberado: true ou false." }) });

export const BuscaMunicipiosSchema = z.strictObject({
  busca: z.string().trim().min(2, { error: "Digite ao menos 2 letras ou o código." }).max(60),
  uf: z.enum(UFS_BRASIL as [string, ...string[]]).optional()
});

export const BuscaEntidadesSchema = z.strictObject({
  busca: z.string().trim().max(60).optional()
});
