// Schemas zod de cliente_prefeitura — compartilhados por três rotas, cada
// regra por campo declarada UMA vez:
//   - POST /api/clientes (criação pela equipe, snake_case),
//   - PATCH /api/clientes/[id] (edição pela equipe, todos os campos opcionais),
//   - POST /api/integracao/clientes (chamada pelo nexaigen-educa, camelCase).
//
// ZOD 4 (rodada 10-A) — por que os defaults NÃO ficam em CAMPOS_CLIENTE:
// no zod 4 um `.default()` dentro de um campo opcional É APLICADO quando a
// chave está ausente (no zod 3 a chave ficava ausente). Com o default no
// campo-base, `.partial()` do PATCH e o `.optional()` da integração
// passariam a gravar plano="essencial"/dia=1 em todo PATCH ou retry do
// Educa que não mandasse esses campos — sobrescrevendo o valor salvo.
// Então: campos-base SEM default; o default é aplicado só no schema de
// CRIAÇÃO (ClienteSchema). lib/clienteSchema.test.ts e
// app/api/clientes/[id]/route.test.ts provam os dois lados.

import { z } from "zod";

const CAMPOS_CLIENTE = {
  nome: z.string().min(3),
  uf: z.string().length(2),
  cnpj: z.string().optional(),
  plano: z.enum(["essencial", "completo"]),
  valor_mensal: z.number().positive(),
  dia_vencimento_contrato: z.number().int().min(1).max(28),
  data_inicio_contrato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Use o formato YYYY-MM-DD." }),
  sistema_portal: z.string().optional(),
  // Só http/https (rodada 10-A): portal_url vira um <a href> clicável na
  // Fila de Checagem — `javascript:`/`data:` (que o zod 3 aceitava) seriam
  // um XSS armazenado. Endereço de portal de prefeitura é sempre http(s).
  portal_url: z.url({ protocol: /^https?$/, error: "Use um endereço http:// ou https://." }).optional(),
  portal_usuario: z.string().optional(),
  contato_nome: z.string().optional(),
  contato_email: z.email().optional(),
  contato_telefone: z.string().optional(),
  observacao: z.string().optional()
};

/** Criação (POST /api/clientes): defaults de plano e dia de vencimento só aqui. Chaves extras são descartadas, como sempre foram. */
export const ClienteSchema = z.object({
  ...CAMPOS_CLIENTE,
  plano: CAMPOS_CLIENTE.plano.default("essencial"),
  dia_vencimento_contrato: CAMPOS_CLIENTE.dia_vencimento_contrato.default(1)
});

/**
 * Edição (PATCH): todos os campos opcionais, só atualiza o que vier, SEM
 * default nenhum. Estrito: municipio_id_externo/contrato_arquivo_* (ou
 * qualquer outra chave) → 400 — contrato só muda pela rota de contrato, o
 * vínculo com o Educa só pela integração. PATCH vazio é dado inválido.
 */
export const ClientePatchSchema = z
  .strictObject(CAMPOS_CLIENTE)
  .partial()
  .refine((c) => Object.values(c).some((v) => v !== undefined), { error: "Envie ao menos um campo para atualizar." });

export type ClientePatch = z.infer<typeof ClientePatchSchema>;

const c = CAMPOS_CLIENTE;

/**
 * Corpo de POST /api/integracao/clientes (nexaigen-educa → Financeiro).
 * camelCase porque é o contrato público entre os dois sistemas; cada
 * regra vem de CAMPOS_CLIENTE. plano/diaVencimentoContrato SEM default
 * (vêm da base): no UPDATE do upsert, campo ausente mantém o valor salvo
 * — o default só se aplica no INSERT, em SQL (ver a rota).
 */
export const IntegracaoClienteSchema = z
  .object({
    municipioIdExterno: z.uuid(),
    nome: c.nome,
    uf: c.uf,
    valorMensal: c.valor_mensal,
    dataInicioContrato: c.data_inicio_contrato,
    plano: c.plano.optional(),
    diaVencimentoContrato: c.dia_vencimento_contrato.optional(),
    cnpj: c.cnpj,
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
  .refine((v) => (v.contratoArquivoBase64 === undefined) === (v.contratoArquivoNome === undefined), {
    error: "contratoArquivoBase64 e contratoArquivoNome devem vir juntos (ou nenhum dos dois).",
    path: ["contratoArquivoNome"]
  });

export type IntegracaoCliente = z.infer<typeof IntegracaoClienteSchema>;
