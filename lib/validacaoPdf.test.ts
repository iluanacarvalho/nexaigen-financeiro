// Testes unitários de lib/validacaoPdf.ts — sanitização do nome e as
// regras de PDF (assinatura, tamanho, tipo) compartilhadas entre nota
// fiscal e contrato. Antes da rodada 06 só eram exercitadas indiretamente
// pelos testes das rotas.

import { describe, expect, it } from "vitest";
import { TAMANHO_MAXIMO_PDF_BYTES, assinaturaPdfValida, lerPdfDeBase64, lerPdfDoFormData, sanitizarNomeArquivo } from "./validacaoPdf";

describe("sanitizarNomeArquivo", () => {
  it.each([
    ["NF-e 123.pdf", "NF-e_123.pdf"],
    ["Contrato Jaguapitã.pdf", "Contrato_Jaguapit_.pdf"],
    ["../../etc/passwd", ".._.._etc_passwd"],
    ['a"b;c\r\nd.pdf', "a_b_c__d.pdf"],
    ["nota_fiscal-2026.10.pdf", "nota_fiscal-2026.10.pdf"]
  ])("%j → %j", (entrada, esperado) => {
    expect(sanitizarNomeArquivo(entrada)).toBe(esperado);
  });

  it("nunca contém barra (não cria subcaminho na chave)", () => {
    expect(sanitizarNomeArquivo("a/b\\c.pdf")).not.toMatch(/[/\\]/);
  });

  it("mantém só os últimos 100 caracteres (preserva a extensão)", () => {
    const resultado = sanitizarNomeArquivo(`${"a".repeat(200)}.pdf`);
    expect(resultado).toHaveLength(100);
    expect(resultado.endsWith(".pdf")).toBe(true);
  });
});

describe("assinaturaPdfValida", () => {
  it("só %PDF- nos 5 primeiros bytes", () => {
    expect(assinaturaPdfValida(Buffer.from("%PDF-1.7"))).toBe(true);
    expect(assinaturaPdfValida(Buffer.from("%PDF"))).toBe(false);
    expect(assinaturaPdfValida(Buffer.from(" %PDF-1.7"))).toBe(false);
  });
});

describe("lerPdfDoFormData", () => {
  function comArquivo(arquivo: File) {
    const fd = new FormData();
    fd.set("arquivo", arquivo);
    return fd;
  }

  it("PDF válido → buffer e nome original", async () => {
    const r = await lerPdfDoFormData(comArquivo(new File(["%PDF-1.4"], "Nota 1.pdf", { type: "application/pdf" })));
    expect(r).toMatchObject({ ok: true, nome: "Nota 1.pdf" });
  });

  it.each([
    ["sem campo arquivo", new FormData()],
    ["tipo errado", comArquivo(new File(["%PDF-1.4"], "a.pdf", { type: "text/plain" }))],
    ["assinatura errada", comArquivo(new File(["isto não é pdf"], "a.pdf", { type: "application/pdf" }))]
  ])("%s → erro", async (_d, fd) => {
    expect((await lerPdfDoFormData(fd)).ok).toBe(false);
  });

  it("acima de 10MB → erro de tamanho", async () => {
    const grande = new Uint8Array(TAMANHO_MAXIMO_PDF_BYTES + 1);
    grande.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const r = await lerPdfDoFormData(comArquivo(new File([grande], "g.pdf", { type: "application/pdf" })));
    expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/grande/) });
  });
});

describe("lerPdfDeBase64", () => {
  it("aceita prefixo data: e espaços/quebras de linha", () => {
    const b64 = Buffer.from("%PDF-1.4 x").toString("base64");
    expect(lerPdfDeBase64(`data:application/pdf;base64,${b64.slice(0, 4)}\n${b64.slice(4)}`).ok).toBe(true);
  });

  it.each(["", "@@@@", "abc"])("%j → erro", (b64) => {
    expect(lerPdfDeBase64(b64).ok).toBe(false);
  });
});
