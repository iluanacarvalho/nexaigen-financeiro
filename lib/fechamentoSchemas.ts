// Schemas Zod do FECHAMENTO (rodada 16-B1) — objetos ESTRITOS (chave
// desconhecida → 400), mensagens do projeto. Dinheiro como TEXTO → centavos
// (lib/dinheiro.ts), CNPJ com dígitos verificadores (lib/cnpj.ts), CEP com
// 8 dígitos. Regras de negócio (lead aberto, duplicidade, papel da tarefa)
// ficam nos serviços.

import { z } from "zod";
import { lerValorMonetario } from "./dinheiro";
import { dataIsoValida } from "./estadoNota";
import { IDS_PLANOS, MENSAGEM_DISPENSA_SEM_TAXA } from "./planos";
import { cnpjValido, somenteDigitos } from "./cnpj";

const texto = (min: number, max: number, rotulo: string) =>
  z
    .string({ error: `Informe ${rotulo}.` })
    .trim()
    .min(min, { error: `Informe ${rotulo}.` })
    .max(max, { error: `Até ${max} caracteres.` });

const dinheiro = z
  .string()
  .max(20)
  .transform((t, ctx) => {
    const r = lerValorMonetario(t);
    if (!r.ok) {
      ctx.issues.push({ code: "custom", message: r.erro, input: t });
      return z.NEVER;
    }
    return r.centavos;
  });

export const dataIso = z.string().refine(dataIsoValida, { error: "Data inválida — use aaaa-mm-dd." });

export const AceiteSchema = z
  .strictObject({
    /** Versão do lead que a tela leu (controle otimista — alguém mudou o lead → 409). */
    versao: z.number().int().min(1, { error: "Envie a versão do lead que você leu." }),
    plano: z.enum(IDS_PLANOS, { error: `Plano inválido — use: ${IDS_PLANOS.join(", ")}.` }),
    valor_mensal: dinheiro,
    /** null = sem implantação combinada. Dispensa nunca tem taxa. */
    taxa_implantacao: dinheiro.nullable(),
    data_prevista_assinatura: dataIso.nullable().optional(),
    cnpj: z
      .string({ error: "Informe o CNPJ." })
      .trim()
      .refine(cnpjValido, { error: "CNPJ inválido — confira os 14 dígitos." })
      .transform(somenteDigitos),
    endereco_logradouro: texto(2, 200, "o logradouro"),
    endereco_numero: texto(1, 20, "o número"),
    endereco_complemento: z
      .string()
      .trim()
      .max(100, { error: "Até 100 caracteres." })
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    endereco_bairro: texto(2, 120, "o bairro"),
    endereco_cep: z
      .string({ error: "Informe o CEP." })
      .trim()
      .transform(somenteDigitos)
      .refine((v) => /^[0-9]{8}$/.test(v), { error: "CEP inválido — 8 dígitos." }),
    representante_nome: texto(3, 200, "o nome do representante legal"),
    representante_cargo: texto(2, 120, "o cargo do representante legal"),
    contato_nome: texto(2, 200, "o nome do contato"),
    contato_cargo: texto(2, 120, "o cargo do contato"),
    contato_email: z
      .string({ error: "Informe o e-mail do contato." })
      .trim()
      .max(254)
      .pipe(z.email({ error: "E-mail inválido." })),
    contato_telefone: texto(8, 40, "o telefone do contato")
  })
  .superRefine((v, ctx) => {
    if (v.plano === "dispensa" && v.taxa_implantacao !== null) ctx.addIssue({ code: "custom", message: MENSAGEM_DISPENSA_SEM_TAXA, path: ["taxa_implantacao"] });
  });
export type DadosAceite = z.output<typeof AceiteSchema>;

export const AcaoTarefaSchema = z.discriminatedUnion(
  "acao",
  [
    z.strictObject({ acao: z.literal("assumir") }),
    z.strictObject({ acao: z.literal("devolver") }),
    z.strictObject({
      acao: z.literal("concluir"),
      observacao: z
        .string()
        .trim()
        .max(1000, { error: "Até 1000 caracteres." })
        .transform((v) => (v === "" ? null : v))
        .nullable()
        .optional()
    }),
    z.strictObject({ acao: z.literal("prazo"), prazo: dataIso }),
    z.strictObject({ acao: z.literal("cancelar"), motivo: texto(3, 500, "o motivo do cancelamento") })
  ],
  { error: "acao inválida — use assumir, devolver, concluir, prazo ou cancelar." }
);
export type AcaoTarefa = z.output<typeof AcaoTarefaSchema>;

export const ABAS_TAREFAS = ["minhas", "fila", "todas", "atrasadas"] as const;
export type AbaTarefas = (typeof ABAS_TAREFAS)[number];
export const ListarTarefasSchema = z.strictObject({ aba: z.enum(ABAS_TAREFAS, { error: "aba inválida." }).default("minhas") });

export const NovaVersaoModeloSchema = z.strictObject({
  plano: z.enum(IDS_PLANOS, { error: "Plano inválido." }),
  titulo: texto(3, 200, "o título"),
  conteudo: z.string({ error: "Informe o texto do modelo." }).min(1, { error: "Informe o texto do modelo." }).max(100_000, { error: "Texto grande demais." })
});

export const PreviaModeloSchema = z.strictObject({
  plano: z.enum(IDS_PLANOS, { error: "Plano inválido." }),
  conteudo: z.string().max(100_000)
});
