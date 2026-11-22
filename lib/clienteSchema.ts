// Schemas zod de cliente_prefeitura — compartilhados por três rotas, cada
// regra por campo declarada UMA vez:
//   - POST /api/clientes (criação pela equipe, snake_case),
//   - PATCH /api/clientes/[id] (edição pela equipe, todos os campos opcionais),
//   - POST /api/integracao/clientes (chamada pelo nexaigen-educa, camelCase).
//
// PLANOS (rodada 11-A): os 4 ids de lib/planos.ts; ids antigos
// ('essencial'/'completo') dão 400 com mensagem clara, nunca mapeados.
// DINHEIRO: valor_mensal e taxa_implantacao entram como TEXTO ("8500",
// "8500,00") e saem em CENTAVOS inteiros (lib/dinheiro.ts#lerValorMonetario)
// — nunca float. (A integração aceita também número JSON por
// compatibilidade com o Educa — ver IntegracaoClienteSchema.)
//
// ZOD 4 — DEFAULTS SÓ NA CRIAÇÃO: no zod 4 um `.default()` dentro de campo
// opcional É APLICADO quando a chave falta. Por isso nenhum campo-base tem
// default: os padrões (plano → mensalidade/taxa de lib/planos.ts, dia de
// vencimento 1) entram só no schema de CRIAÇÃO. No PATCH e na integração,
// campo ausente continua ausente (nunca regrava o padrão por cima do
// valor combinado).

import { z } from "zod";
import { lerValorMonetario } from "./dinheiro";
import { IDS_PLANOS, IDS_PLANOS_DESCONTINUADOS, MENSAGEM_DISPENSA_SEM_TAXA, mensagemPlanoDescontinuado, precosDeCriacao } from "./planos";
import { cnpjValido, somenteDigitos } from "./cnpj";

export const MENSAGEM_INICIO_NA_ASSINATURA =
  "Este cliente aguarda assinatura: a data de início do contrato vem do registro da assinatura (tarefa de Contratos), não da edição.";

/**
 * CNPJ nas rotas da EQUIPE (16-B1): o banco guarda só os 14 dígitos (CHECK
 * da 0017) — pontuação é aceita e removida; dígito verificador errado → 400.
 * Vazio = sem CNPJ.
 */
const cnpjDaEquipe = z
  .string()
  .trim()
  .transform(somenteDigitos)
  .refine((v) => v === "" || cnpjValido(v), { error: "CNPJ inválido — confira os 14 dígitos." })
  .transform((v) => (v === "" ? undefined : v));

/**
 * CNPJ vindo do EDUCA: o contrato público da integração aceitava texto livre
 * — continua aceitando (nunca 400 por isso). Válido → os 14 dígitos; o que
 * não for um CNPJ válido é IGNORADO (no UPDATE mantém o salvo; no INSERT fica
 * sem CNPJ) em vez de quebrar o cadastro.
 */
const cnpjDaIntegracao = z
  .string()
  .optional()
  .transform((v) => (v !== undefined && cnpjValido(v) ? somenteDigitos(v) : undefined));

const planoSchema = z.enum(IDS_PLANOS, {
  error: (issue) =>
    typeof issue.input === "string" && (IDS_PLANOS_DESCONTINUADOS as readonly string[]).includes(issue.input)
      ? mensagemPlanoDescontinuado(issue.input)
      : `Plano inválido — use um destes: ${IDS_PLANOS.join(", ")}.`
});

/** Texto monetário → centavos inteiros (mesma regra do valor da nota fiscal). */
function textoMonetario() {
  return z
    .string()
    .max(20)
    .transform((texto, ctx) => {
      const r = lerValorMonetario(texto);
      if (!r.ok) {
        ctx.issues.push({ code: "custom", message: r.erro, input: texto });
        return z.NEVER;
      }
      return r.centavos;
    });
}

const CAMPOS_CLIENTE = {
  nome: z.string().min(3),
  uf: z.string().length(2),
  cnpj: cnpjDaEquipe.optional(),
  plano: planoSchema,
  valor_mensal: textoMonetario(),
  /** null = sem implantação combinada. */
  taxa_implantacao: textoMonetario().nullable(),
  dia_vencimento_contrato: z.number().int().min(1).max(28),
  data_inicio_contrato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Use o formato YYYY-MM-DD." }),
  sistema_portal: z.string().optional(),
  // Só http/https (rodada 10-A): portal_url vira um <a href> clicável na
  // Fila de Checagem — `javascript:`/`data:` seriam um XSS armazenado.
  portal_url: z.url({ protocol: /^https?$/, error: "Use um endereço http:// ou https://." }).optional(),
  portal_usuario: z.string().optional(),
  contato_nome: z.string().optional(),
  contato_email: z.email().optional(),
  contato_telefone: z.string().optional(),
  observacao: z.string().optional()
};

/** Dispensa nunca tem taxa — vale pra criação, PATCH e integração (o banco também garante: ck_cliente_prefeitura_dispensa_sem_taxa). */
function dispensaSemTaxa(plano: string | undefined, taxa: number | null | undefined, campoTaxa: string, ctx: z.RefinementCtx) {
  if (plano === "dispensa" && taxa !== undefined && taxa !== null) {
    ctx.addIssue({ code: "custom", message: MENSAGEM_DISPENSA_SEM_TAXA, path: [campoTaxa] });
  }
}

/**
 * Criação (POST /api/clientes): plano obrigatório; valor_mensal e
 * taxa_implantacao opcionais — AUSENTES usam o padrão do plano
 * (lib/planos.ts#precosDeCriacao); enviados valem como vieram (o servidor
 * não força o padrão). Saída já em centavos, com os padrões resolvidos.
 * Chaves extras são descartadas, como sempre foram nesta rota.
 */
export const ClienteSchema = z
  .object({
    ...CAMPOS_CLIENTE,
    valor_mensal: CAMPOS_CLIENTE.valor_mensal.optional(),
    taxa_implantacao: CAMPOS_CLIENTE.taxa_implantacao.optional(),
    dia_vencimento_contrato: CAMPOS_CLIENTE.dia_vencimento_contrato.default(1)
  })
  .superRefine((c, ctx) => dispensaSemTaxa(c.plano, c.taxa_implantacao, "taxa_implantacao", ctx))
  .transform((c) => {
    const precos = precosDeCriacao(c.plano, { valorMensalCentavos: c.valor_mensal, taxaImplantacaoCentavos: c.taxa_implantacao });
    // dispensaSemTaxa já recusou o único caso de erro de precosDeCriacao.
    if (!precos.ok) throw new Error(precos.erro);
    return { ...c, valor_mensal: precos.valorMensalCentavos, taxa_implantacao: precos.taxaImplantacaoCentavos };
  });

export type ClienteCriacao = z.output<typeof ClienteSchema>;

/**
 * Edição (PATCH): todos os campos opcionais, só atualiza o que vier, SEM
 * default nenhum (trocar de plano NÃO reprecifica sozinho — a tela pede
 * confirmação e manda os valores novos explicitamente). Estrito:
 * municipio_id_externo/contrato_arquivo_* (ou qualquer outra chave) → 400.
 * PATCH vazio é dado inválido.
 */
export const ClientePatchSchema = z
  .strictObject(CAMPOS_CLIENTE)
  .partial()
  .superRefine((c, ctx) => dispensaSemTaxa(c.plano, c.taxa_implantacao, "taxa_implantacao", ctx))
  .refine((c) => Object.values(c).some((v) => v !== undefined), { error: "Envie ao menos um campo para atualizar." });

export type ClientePatch = z.output<typeof ClientePatchSchema>;

const c = CAMPOS_CLIENTE;

/**
 * Dinheiro na integração: texto (preferido) OU número JSON — o Educa
 * envia `valorMensal` como número desde a rodada 04, e trocar o tipo
 * quebraria a integração em silêncio. O número é convertido pela sua
 * representação DECIMAL (String(n) — "8500.5"), validada pela mesma regra
 * de texto (até 2 casas); nunca há conta em ponto flutuante.
 */
function dinheiroDaIntegracao() {
  return z.union([z.string(), z.number()]).pipe(z.transform((v) => (typeof v === "number" ? String(v) : v))).pipe(textoMonetario());
}

/**
 * Corpo de POST /api/integracao/clientes (nexaigen-educa → Financeiro).
 * camelCase porque é o contrato público entre os dois sistemas; cada
 * regra vem de CAMPOS_CLIENTE. plano, valorMensal e taxaImplantacao SEM
 * default aqui: no UPDATE do upsert, ausente mantém o valor salvo; no
 * INSERT a rota usa os padrões do plano (lib/planos.ts).
 */
export const IntegracaoClienteSchema = z
  .object({
    municipioIdExterno: z.uuid(),
    nome: c.nome,
    uf: c.uf,
    valorMensal: dinheiroDaIntegracao().optional(),
    taxaImplantacao: dinheiroDaIntegracao().nullable().optional(),
    dataInicioContrato: c.data_inicio_contrato,
    plano: c.plano.optional(),
    diaVencimentoContrato: c.dia_vencimento_contrato.optional(),
    cnpj: cnpjDaIntegracao,
    /** Código IBGE (16-B1, OPCIONAL — retrocompatível): casa com o cliente criado pelo fechamento no CRM. */
    codigoIbge: z.string().trim().regex(/^[0-9]{7}$/, { error: "O código IBGE do município tem exatamente 7 dígitos." }).optional(),
    sistemaPortal: c.sistema_portal,
    portalUrl: c.portal_url,
    portalUsuario: c.portal_usuario,
    contatoNome: c.contato_nome,
    contatoEmail: c.contato_email,
    contatoTelefone: c.contato_telefone,
    observacao: c.observacao,
    contratoArquivoBase64: z.string().min(1).optional(),
    contratoArquivoNome: z.string().min(1).max(255).optional()
  })
  .superRefine((v, ctx) => dispensaSemTaxa(v.plano, v.taxaImplantacao, "taxaImplantacao", ctx))
  .refine((v) => (v.contratoArquivoBase64 === undefined) === (v.contratoArquivoNome === undefined), {
    error: "contratoArquivoBase64 e contratoArquivoNome devem vir juntos (ou nenhum dos dois).",
    path: ["contratoArquivoNome"]
  });

export type IntegracaoCliente = z.output<typeof IntegracaoClienteSchema>;
