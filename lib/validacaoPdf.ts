// Validação de PDF enviado por upload — extraída de
// app/api/notas/[id]/arquivo/route.ts quando o contrato da prefeitura
// (app/api/clientes/[id]/contrato, app/api/integracao/clientes) passou a
// precisar exatamente das MESMAS regras. Fica fora de
// lib/armazenamentoObjetos.ts de propósito: aquele módulo só sabe subir
// bytes, quem decide o que é aceito é a rota que chama.
//
// Assinatura real (`%PDF-` nos 5 primeiros bytes), nunca só o
// Content-Type/nome declarado pelo chamador — ver comentário de topo de
// app/api/notas/[id]/arquivo/route.ts.

export const TAMANHO_MAXIMO_PDF_BYTES = 10 * 1024 * 1024; // 10MB
export const TIPO_MIME_PDF = "application/pdf";

// Assinatura real de um PDF (magic bytes) — "%PDF-" em ASCII.
const ASSINATURA_PDF = Buffer.from("%PDF-", "ascii");

export function assinaturaPdfValida(buffer: Buffer): boolean {
  return buffer.subarray(0, ASSINATURA_PDF.length).equals(ASSINATURA_PDF);
}

/** Remove caracteres que não são seguros num path de objeto S3/nome de arquivo. */
export function sanitizarNomeArquivo(nome: string): string {
  return nome.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

export const MENSAGEM_TAMANHO_EXCEDIDO = `Arquivo muito grande — limite de ${TAMANHO_MAXIMO_PDF_BYTES / (1024 * 1024)}MB.`;
export const MENSAGEM_ASSINATURA_INVALIDA =
  "O arquivo enviado não é um PDF válido (assinatura do arquivo não confere com application/pdf).";

export type ResultadoPdf = { ok: true; buffer: Buffer; nome: string } | { ok: false; erro: string };

/**
 * Valida o campo `arquivo` de um multipart/form-data: presença, Content-Type
 * application/pdf, tamanho ≤ 10MB e assinatura `%PDF-`.
 */
export async function lerPdfDoFormData(formData: FormData): Promise<ResultadoPdf> {
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File)) return { ok: false, erro: "Campo 'arquivo' é obrigatório." };
  if (arquivo.type !== TIPO_MIME_PDF) {
    return { ok: false, erro: "Tipo de arquivo não aceito — envie um PDF (application/pdf)." };
  }
  if (arquivo.size > TAMANHO_MAXIMO_PDF_BYTES) return { ok: false, erro: MENSAGEM_TAMANHO_EXCEDIDO };

  const buffer = Buffer.from(await arquivo.arrayBuffer());
  if (!assinaturaPdfValida(buffer)) return { ok: false, erro: MENSAGEM_ASSINATURA_INVALIDA };
  return { ok: true, buffer, nome: arquivo.name };
}

const BASE64_ESTRITO = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decodifica um PDF enviado em base64 (corpo JSON da integração com o
 * Educa). `Buffer.from(_, "base64")` é permissivo (ignora caractere
 * inválido em silêncio), então o formato é conferido antes; o tamanho é
 * estimado ANTES de decodificar (nunca aloca um buffer gigante só pra
 * recusá-lo depois) e conferido de novo depois. Aceita um prefixo
 * `data:application/pdf;base64,` opcional.
 */
export function lerPdfDeBase64(base64: string): { ok: true; buffer: Buffer } | { ok: false; erro: string } {
  const limpo = base64.replace(/^data:application\/pdf;base64,/, "").replace(/\s+/g, "");
  if (limpo.length === 0 || limpo.length % 4 !== 0 || !BASE64_ESTRITO.test(limpo)) {
    return { ok: false, erro: "contratoArquivoBase64 não é um base64 válido." };
  }
  if (Math.floor((limpo.length * 3) / 4) > TAMANHO_MAXIMO_PDF_BYTES + 2) return { ok: false, erro: MENSAGEM_TAMANHO_EXCEDIDO };

  const buffer = Buffer.from(limpo, "base64");
  if (buffer.length > TAMANHO_MAXIMO_PDF_BYTES) return { ok: false, erro: MENSAGEM_TAMANHO_EXCEDIDO };
  if (!assinaturaPdfValida(buffer)) return { ok: false, erro: MENSAGEM_ASSINATURA_INVALIDA };
  return { ok: true, buffer };
}
