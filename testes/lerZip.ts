// Helper SÓ de teste: lê um ZIP (store ou deflate) pelo diretório central e
// devolve { nome do arquivo: conteúdo UTF-8 }, conferindo o CRC32 de cada
// arquivo. Usado pra abrir os .xlsx gerados (relatório de contratos — 15-A;
// carteira do CRM — 16-A1) e conferir o XML de dentro.

import { inflateRawSync } from "node:zlib";
import { expect } from "vitest";
import { crc32 } from "@/lib/xlsx";

/** Lê um ZIP (store ou deflate) pelo diretório central → { nome: conteúdo }. Confere o CRC de cada arquivo. */
export function lerZip(zip: Buffer): Record<string, string> {
  const fim = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const arquivos: Record<string, string> = {};
  for (let i = 0; i < total; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const metodo = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const tamanho = zip.readUInt32LE(p + 20);
    const nomeLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const comentarioLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const nome = zip.subarray(p + 46, p + 46 + nomeLen).toString("utf8");
    const inicioDados = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const bruto = zip.subarray(inicioDados, inicioDados + tamanho);
    const conteudo = metodo === 0 ? bruto : inflateRawSync(bruto);
    expect(crc32(conteudo)).toBe(crc);
    arquivos[nome] = conteudo.toString("utf8");
    p += 46 + nomeLen + extraLen + comentarioLen;
  }
  return arquivos;
}
