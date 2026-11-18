// Schemas Zod do CRM (rodada 16-A) — validação de FORMA, objetos estritos
// (chave desconhecida → 400). Regras de negócio (transição, duplicidade,
// escopo) ficam em lib/crm.ts / lib/crmServico.ts. API em snake_case, como
// a de clientes e notas. Dinheiro como TEXTO ("8500,00") → centavos
// inteiros (lib/dinheiro.ts), nunca number do JSON.

import { z } from "zod";
import { lerValorMonetario } from "./dinheiro";
import { dataIsoValida } from "./estadoNota";
import { codigoIbgeValido, UF_POR_CODIGO } from "./ibge";
import { IDS_PLANOS } from "./planos";
import { ETAPAS, MOTIVOS_PERDA, ORIGENS, TIPOS_CONTATO } from "./crm";
import { ORDENACOES_LEAD } from "./crmRepositorio";
import { PLANOS_FILTRO, type PlanoFiltro } from "./territorio";

export const UFS = Object.values(UF_POR_CODIGO).sort() as [string, ...string[]];
export const POR_PAGINA_MAXIMO_CRM = 100;

/** Texto opcional: aparado; vazio vira null. */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Até ${max} caracteres.` })
    .transform((v) => (v === "" ? null : v))
    .nullable();

const dataIso = z.string().refine(dataIsoValida, { error: "Data inválida — use aaaa-mm-dd." });

const dinheiro = z
  .string()
  .max(20)
  .transform((texto, ctx) => {
    if (texto.trim() === "") return null;
    const r = lerValorMonetario(texto);
    if (!r.ok) {
      ctx.issues.push({ code: "custom", message: r.erro, input: texto });
      return z.NEVER;
    }
    return r.centavos;
  })
  .nullable();

const CAMPOS = {
  municipio_nome: z.string().trim().min(2, { error: "Informe o município." }).max(200),
  uf: z.enum(UFS, { error: "UF inválida." }),
  codigo_ibge: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || codigoIbgeValido(v), { error: "O código IBGE do município tem exatamente 7 dígitos." })
    .nullable(),
  populacao: z.number().int().min(0).max(30_000_000).nullable(),
  plano_interesse: z.enum(IDS_PLANOS, { error: `Plano inválido — use: ${IDS_PLANOS.join(", ")}.` }).nullable(),
  valor_mensal_estimado: dinheiro,
  contato_nome: textoOpcional(200),
  contato_cargo: textoOpcional(120),
  contato_email: z
    .string()
    .trim()
    .max(254)
    .transform((v) => (v === "" ? null : v))
    .pipe(z.email({ error: "E-mail inválido." }).nullable())
    .nullable(),
  contato_telefone: textoOpcional(40),
  origem: z.enum(ORIGENS, { error: `Origem inválida — use: ${ORIGENS.join(", ")}.` }),
  proxima_acao_em: dataIso.nullable(),
  proxima_acao_descricao: textoOpcional(300)
};

const descricaoPrecisaDeData = (v: { proxima_acao_em?: string | null; proxima_acao_descricao?: string | null }) =>
  !v.proxima_acao_descricao || !!v.proxima_acao_em;

export const NovoLeadSchema = z
  .strictObject({
    ...CAMPOS,
    codigo_ibge: CAMPOS.codigo_ibge.optional(),
    populacao: CAMPOS.populacao.optional(),
    plano_interesse: CAMPOS.plano_interesse.optional(),
    valor_mensal_estimado: CAMPOS.valor_mensal_estimado.optional(),
    contato_nome: CAMPOS.contato_nome.optional(),
    contato_cargo: CAMPOS.contato_cargo.optional(),
    contato_email: CAMPOS.contato_email.optional(),
    contato_telefone: CAMPOS.contato_telefone.optional(),
    proxima_acao_em: CAMPOS.proxima_acao_em.optional(),
    proxima_acao_descricao: CAMPOS.proxima_acao_descricao.optional(),
    /** Só admin atribui a outro vendedor (o serviço recusa pra vendas). */
    vendedor_id: z.uuid().optional()
  })
  .refine(descricaoPrecisaDeData, { error: "Informe a data da próxima ação junto com a descrição.", path: ["proxima_acao_descricao"] });

export const EditarLeadSchema = z
  .strictObject({ versao: z.number().int().min(1, { error: "Envie a versão do lead que você leu." }), ...CAMPOS })
  .partial()
  .refine((v) => v.versao !== undefined, { error: "Envie a versão do lead que você leu.", path: ["versao"] })
  .refine((v) => Object.keys(v).some((k) => k !== "versao"), { error: "Envie ao menos um campo para atualizar." });

export const InteracaoSchema = z.strictObject({
  tipo: z.enum(TIPOS_CONTATO, { error: `Tipo inválido — use: ${TIPOS_CONTATO.join(", ")}.` }),
  texto: z.string().trim().min(1, { error: "Escreva o que aconteceu." }).max(2000, { error: "Até 2000 caracteres." })
});

export const EtapaSchema = z.discriminatedUnion(
  "acao",
  [
    z.strictObject({ acao: z.literal("mover"), etapa: z.enum(ETAPAS, { error: "Etapa inválida." }) }),
    z.strictObject({
      acao: z.literal("perder"),
      motivo: z.enum(MOTIVOS_PERDA, { error: `Informe o motivo da perda: ${MOTIVOS_PERDA.join(", ")}.` }),
      detalhe: textoOpcional(1000).optional()
    }),
    z.strictObject({ acao: z.literal("reabrir") })
  ],
  { error: "acao inválida — use mover, perder ou reabrir." }
);

export const VendedorSchema = z.strictObject({ vendedor_id: z.uuid({ error: "vendedor_id inválido." }) });
export const DecisaoPedidoSchema = z.strictObject({ decisao: z.enum(["aprovado", "negado"], { error: "decisao inválida — use aprovado ou negado." }) });

const booleanoQuery = z.enum(["true", "false"]).transform((v) => v === "true");
const paginacao = {
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  por_pagina: z.coerce.number().int().min(1).max(POR_PAGINA_MAXIMO_CRM, { error: `No máximo ${POR_PAGINA_MAXIMO_CRM} por página.` }).default(25)
};

/** Query string de GET /api/leads (e da exportação, que acrescenta `formato`). */
export const FiltrosLeadsSchema = z.strictObject({
  etapa: z.enum(ETAPAS).optional(),
  vendedor_id: z.uuid().optional(),
  uf: z.enum(UFS).optional(),
  origem: z.enum(ORIGENS).optional(),
  busca: z.string().trim().min(1).max(60).optional(),
  parados: booleanoQuery.optional(),
  vencidas: booleanoQuery.optional(),
  /** Plano efetivo (rodada 16-A2): lista separada por vírgula — ids de plano e/ou sem_plano. */
  plano: z
    .string()
    .max(200)
    .transform((v, ctx) => {
      const itens = [...new Set(v.split(",").map((x) => x.trim()).filter(Boolean))];
      const invalidos = itens.filter((x) => !(PLANOS_FILTRO as readonly string[]).includes(x));
      if (invalidos.length) {
        ctx.issues.push({ code: "custom", message: `Plano inválido: ${invalidos.join(", ")} — use: ${PLANOS_FILTRO.join(", ")}.`, input: v });
        return z.NEVER;
      }
      return itens as PlanoFiltro[];
    })
    .optional(),
  ignorar_sugerido: booleanoQuery.optional(),
  entidade: z.uuid({ error: "entidade inválida." }).optional(),
  ordenar: z.enum(ORDENACOES_LEAD).default("atualizado"),
  direcao: z.enum(["asc", "desc"]).default("desc"),
  ...paginacao
});

export const ExportarLeadsSchema = FiltrosLeadsSchema.omit({ pagina: true, por_pagina: true }).extend({
  formato: z.enum(["csv", "xlsx"], { error: "formato inválido — use csv ou xlsx." })
});

export const ConsultaLeadsSchema = z
  .strictObject({
    busca: z.string().trim().min(2, { error: "Digite ao menos 2 letras do município." }).max(60).optional(),
    uf: z.enum(UFS).optional(),
    codigo_ibge: z.string().trim().refine(codigoIbgeValido, { error: "O código IBGE do município tem exatamente 7 dígitos." }).optional(),
    ...paginacao
  })
  .refine((v) => v.busca !== undefined || v.uf !== undefined || v.codigo_ibge !== undefined, { error: "Informe o município, a UF ou o código IBGE." });
