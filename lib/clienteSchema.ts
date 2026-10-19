// Schema zod de cliente_prefeitura — movido de app/api/clientes/route.ts
// (um route.ts do Next só pode exportar handlers/configs de rota) quando
// três rotas passaram a precisar das MESMAS regras por campo:
//   - POST /api/clientes (criação pela equipe, snake_case),
//   - PATCH /api/clientes/[id] (edição pela equipe, todos os campos opcionais),
//   - POST /api/integracao/clientes (chamada pelo nexaigen-educa, camelCase —
//     reaproveita cada campo daqui via `.shape`, nunca redeclara a regra).

import { z } from "zod";

export const ClienteSchema = z.object({
  nome: z.string().min(3),
  uf: z.string().length(2),
  cnpj: z.string().optional(),
  plano: z.enum(["essencial", "completo"]).default("essencial"),
  valor_mensal: z.number().positive(),
  dia_vencimento_contrato: z.number().int().min(1).max(28).default(1),
  data_inicio_contrato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato YYYY-MM-DD."),
  sistema_portal: z.string().optional(),
  portal_url: z.string().url().optional(),
  portal_usuario: z.string().optional(),
  contato_nome: z.string().optional(),
  contato_email: z.string().email().optional(),
  contato_telefone: z.string().optional(),
  observacao: z.string().optional()
});

/**
 * PATCH: todos os campos opcionais, só atualiza o que vier. `.partial()`
 * envolve os `.default()` em `.optional()` — campo ausente continua
 * `undefined` (nunca volta pro default e sobrescreve o valor salvo).
 * Pelo menos um campo é exigido (PATCH vazio é dado inválido, não no-op).
 */
export const ClientePatchSchema = ClienteSchema.partial()
  .strict()
  .refine((c) => Object.values(c).some((v) => v !== undefined), { message: "Envie ao menos um campo para atualizar." });

export type ClientePatch = z.infer<typeof ClientePatchSchema>;

const s = ClienteSchema.shape;

/**
 * Corpo de POST /api/integracao/clientes (nexaigen-educa → Financeiro).
 * camelCase porque é o contrato público entre os dois sistemas; cada
 * regra vem de ClienteSchema. plano/dia_vencimento_contrato SEM default
 * aqui (`removeDefault`): no UPDATE do upsert, campo ausente mantém o
 * valor já salvo — o default só se aplica no INSERT (ver a rota).
 */
export const IntegracaoClienteSchema = z
  .object({
    municipioIdExterno: z.string().uuid(),
    nome: s.nome,
    uf: s.uf,
    valorMensal: s.valor_mensal,
    dataInicioContrato: s.data_inicio_contrato,
    plano: s.plano.removeDefault().optional(),
    diaVencimentoContrato: s.dia_vencimento_contrato.removeDefault().optional(),
    cnpj: s.cnpj,
    sistemaPortal: s.sistema_portal,
    portalUrl: s.portal_url,
    portalUsuario: s.portal_usuario,
    contatoNome: s.contato_nome,
    contatoEmail: s.contato_email,
    contatoTelefone: s.contato_telefone,
    observacao: s.observacao,
    contratoArquivoBase64: z.string().min(1).optional(),
    contratoArquivoNome: z.string().min(1).max(255).optional()
  })
  .refine((c) => (c.contratoArquivoBase64 === undefined) === (c.contratoArquivoNome === undefined), {
    message: "contratoArquivoBase64 e contratoArquivoNome devem vir juntos (ou nenhum dos dois).",
    path: ["contratoArquivoNome"]
  });

export type IntegracaoCliente = z.infer<typeof IntegracaoClienteSchema>;
