// Testes unitários de lib/versaoArquivo.ts — puros, sem banco, sem bucket.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  calcularMetadadosArquivo,
  lerMotivo,
  lerParametroVersao,
  montarChaveVersao,
  montarContentDisposition,
  proximaVersao
} from "./versaoArquivo";

describe("calcularMetadadosArquivo", () => {
  it("sha256 hex de 64 caracteres e tamanho em bytes do conteúdo exato", () => {
    const buffer = Buffer.from("%PDF-1.4 conteúdo");
    const { tamanhoBytes, sha256 } = calcularMetadadosArquivo(buffer);
    expect(tamanhoBytes).toBe(buffer.length);
    expect(tamanhoBytes).toBe(18); // "ú" ocupa 2 bytes em UTF-8 — conta bytes, não caracteres
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256).toBe(createHash("sha256").update(buffer).digest("hex"));
  });

  it("vetor conhecido: sha256 de buffer vazio", () => {
    expect(calcularMetadadosArquivo(Buffer.alloc(0))).toEqual({
      tamanhoBytes: 0,
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    });
  });

  it("um byte diferente muda o hash", () => {
    expect(calcularMetadadosArquivo(Buffer.from("%PDF-a")).sha256).not.toBe(calcularMetadadosArquivo(Buffer.from("%PDF-b")).sha256);
  });
});

describe("proximaVersao", () => {
  it.each([
    [null, 1],
    [1, 2],
    [41, 42]
  ])("maior versão %s → %i", (maior, esperado) => {
    expect(proximaVersao(maior)).toBe(esperado);
  });
});

describe("lerParametroVersao", () => {
  it("ausente → versão atual (null)", () => {
    expect(lerParametroVersao(null)).toEqual({ ok: true, versao: null });
  });

  it.each([
    ["1", 1],
    ["2", 2],
    ["123456789", 123456789]
  ])("%j → %i", (valor, esperado) => {
    expect(lerParametroVersao(valor)).toEqual({ ok: true, versao: esperado });
  });

  it.each(["", "0", "-1", "+1", "01", "1.0", "1e3", " 1", "1 ", "abc", "0x10", "1234567890", "２"])("%j → inválido", (valor) => {
    expect(lerParametroVersao(valor).ok).toBe(false);
  });
});

describe("lerMotivo", () => {
  it("ausente ou só espaços → null", () => {
    expect(lerMotivo(null)).toEqual({ ok: true, motivo: null });
    expect(lerMotivo("   ")).toEqual({ ok: true, motivo: null });
  });

  it("apara espaços e aceita exatamente 300 caracteres", () => {
    expect(lerMotivo("  NF reemitida com CNPJ corrigido  ")).toEqual({ ok: true, motivo: "NF reemitida com CNPJ corrigido" });
    expect(lerMotivo("a".repeat(300))).toEqual({ ok: true, motivo: "a".repeat(300) });
  });

  it("301 caracteres → inválido", () => {
    expect(lerMotivo("a".repeat(301)).ok).toBe(false);
  });

  it("arquivo no lugar de texto → inválido", () => {
    expect(lerMotivo(new File(["x"], "motivo.txt")).ok).toBe(false);
  });
});

describe("montarChaveVersao", () => {
  it("prefixo da nota + /versoes/{id único}/ + nome sanitizado", () => {
    expect(montarChaveVersao("nota-1", "uuid-1", "NF 123 / Jaguapitã.pdf")).toBe("financeiro/notas-fiscais/nota-1/versoes/uuid-1/NF_123___Jaguapit_.pdf");
  });

  it("mesmo nome de arquivo, ids diferentes → chaves diferentes (nunca sobrescreve)", () => {
    expect(montarChaveVersao("n", "a", "x.pdf")).not.toBe(montarChaveVersao("n", "b", "x.pdf"));
  });

  it("nome com ../ não escapa do prefixo", () => {
    const chave = montarChaveVersao("n", "a", "../../outra-nota/x.pdf");
    expect(chave.startsWith("financeiro/notas-fiscais/n/versoes/a/")).toBe(true);
    expect(chave.slice("financeiro/notas-fiscais/n/versoes/a/".length)).not.toContain("/");
  });
});

describe("montarContentDisposition", () => {
  it("filename sanitizado (ASCII) + filename* com o original codificado", () => {
    expect(montarContentDisposition("NF Jaguapitã.pdf")).toBe(`attachment; filename="NF_Jaguapit_.pdf"; filename*=UTF-8''NF%20Jaguapit%C3%A3.pdf`);
  });

  it("aspas, CR/LF e ponto-e-vírgula não injetam parâmetro nem header", () => {
    const valor = montarContentDisposition('x".pdf\r\nSet-Cookie: a=b; filename="evil.exe');
    expect(valor).not.toMatch(/[\r\n]/);
    const [, filename] = /filename="([^"]*)"/.exec(valor)!;
    expect(filename).toMatch(/^[A-Za-z0-9._-]+$/);
    // Depois do prefixo `UTF-8''` (que tem aspas simples por definição da RFC 5987), só percent-encoding.
    expect(valor.split("filename*=UTF-8''")[1]).toMatch(/^[A-Za-z0-9%._~!-]+$/);
  });

  it("nome vazio cai pra um nome padrão", () => {
    expect(montarContentDisposition("")).toContain('filename="nota-fiscal.pdf"');
  });
});
