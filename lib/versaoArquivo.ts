// Regras PURAS do histórico de versões do PDF da nota fiscal
// (db/migrations/0005_nota_fiscal_arquivo_versao.sql) — sem I/O, testadas
// em lib/versaoArquivo.test.ts. Quem orquestra bucket + transação é
// app/api/notas/[id]/arquivo/route.ts.

import { createHash } from "node:crypto";
import { sanitizarNomeArquivo } from "./validacaoPdf";

export const TAMANHO_MAXIMO_MOTIVO = 300;

/** Tamanho em bytes e sha256 (hex minúsculo, 64 caracteres) do conteúdo exato recebido. */
export function calcularMetadadosArquivo(buffer: Buffer): { tamanhoBytes: number; sha256: string } {
  return { tamanhoBytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
}

/**
 * Próxima versão a partir do maior número já gravado pra nota (null =
 * nenhuma versão ainda → 1). A rota lê esse máximo DENTRO da transação,
 * com a linha da nota travada (`for update`) — é isso que impede dois
 * envios simultâneos de calcularem o mesmo número; o unique
 * (nota_fiscal_id, versao) é a segunda barreira.
 */
export function proximaVersao(maiorVersaoAtual: number | null): number {
  return (maiorVersaoAtual ?? 0) + 1;
}

export type ResultadoVersao = { ok: true; versao: number | null } | { ok: false; erro: string };

const VERSAO_VALIDA = /^[1-9]\d{0,8}$/;

/**
 * `?versao=N` do download. Ausente → versão atual (versao: null).
 * Presente: só inteiro positivo em decimal, sem sinal, espaço, zero à
 * esquerda nem notação científica (até 9 dígitos — cabe em `int`).
 * Qualquer outra coisa → inválido (400), nunca "arredondado" pra algo.
 */
export function lerParametroVersao(valor: string | null): ResultadoVersao {
  if (valor === null) return { ok: true, versao: null };
  if (!VERSAO_VALIDA.test(valor)) return { ok: false, erro: "Parâmetro 'versao' inválido — use um número inteiro positivo." };
  return { ok: true, versao: Number(valor) };
}

export type ResultadoMotivo = { ok: true; motivo: string | null } | { ok: false; erro: string };

/** Motivo da substituição (campo `motivo` do formulário): opcional, aparado, até 300 caracteres. Vazio → null. */
export function lerMotivo(valor: FormDataEntryValue | null): ResultadoMotivo {
  if (valor === null) return { ok: true, motivo: null };
  if (typeof valor !== "string") return { ok: false, erro: "Campo 'motivo' precisa ser texto." };
  const motivo = valor.trim();
  if (motivo.length === 0) return { ok: true, motivo: null };
  if (motivo.length > TAMANHO_MAXIMO_MOTIVO) {
    return { ok: false, erro: `Motivo muito longo — limite de ${TAMANHO_MAXIMO_MOTIVO} caracteres.` };
  }
  return { ok: true, motivo };
}

/**
 * Chave do objeto de UMA versão: `financeiro/notas-fiscais/{notaId}/versoes/{idUnico}/{nome sanitizado}`.
 * `idUnico` (uuid gerado por envio) garante que um envio nunca grava por
 * cima do objeto de outro — nem de outra versão da mesma nota, nem de um
 * envio concorrente — independente do nome do arquivo.
 */
export function montarChaveVersao(notaId: string, idUnico: string, nomeOriginal: string): string {
  return `financeiro/notas-fiscais/${notaId}/versoes/${idUnico}/${sanitizarNomeArquivo(nomeOriginal)}`;
}

/**
 * Content-Disposition seguro pro download: `filename` só com o nome
 * sanitizado (ASCII sem aspas/barra/CR/LF — não há como injetar header
 * nem caminho) + `filename*` (RFC 5987) com o nome original codificado em
 * percent-encoding, pra navegadores modernos mostrarem acentos.
 */
export function montarContentDisposition(nomeOriginal: string): string {
  const seguro = sanitizarNomeArquivo(nomeOriginal) || "nota-fiscal.pdf";
  const original = nomeOriginal.replace(/[\u0000-\u001f\u007f]/g, "");
  // encodeURIComponent deixa ' ( ) * passarem — fora do attr-char da RFC 5987, então também codificados.
  const codificado = encodeURIComponent(original || seguro).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${seguro}"; filename*=UTF-8''${codificado}`;
}
