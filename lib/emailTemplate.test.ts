import { describe, expect, it } from "vitest";
import { montarEmailHtml } from "./emailTemplate";

describe("montarEmailHtml", () => {
  it("inclui produto e corpoHtml no HTML final", () => {
    const html = montarEmailHtml({ produto: "NEXAIGEN", corpoHtml: "<p>Olá, mundo!</p>" });

    expect(html).toContain("NEXAIGEN");
    expect(html).toContain("<p>Olá, mundo!</p>");
  });

  it("sem rodapé — mostra só 'NEXAIGEN'", () => {
    const html = montarEmailHtml({ produto: "NEXAIGEN", corpoHtml: "<p>x</p>" });

    expect(html).toContain(">NEXAIGEN<");
  });

  it("com rodapé — mostra 'NEXAIGEN — {rodape}'", () => {
    const html = montarEmailHtml({ produto: "NEXAIGEN", corpoHtml: "<p>x</p>", rodape: "Cobrança" });

    expect(html).toContain("NEXAIGEN — Cobrança");
  });

  it("é uma função pura — mesma entrada produz a mesma saída", () => {
    const opts = { produto: "NEXAIGEN", corpoHtml: "<p>a</p>", rodape: "b" };

    expect(montarEmailHtml(opts)).toBe(montarEmailHtml(opts));
  });

  it("usa layout de tabela com CSS inline (sem <style>), compatível com clientes de e-mail", () => {
    const html = montarEmailHtml({ produto: "NEXAIGEN", corpoHtml: "<p>x</p>" });

    expect(html).toContain("<table");
    expect(html).not.toContain("<style");
    expect(html).toContain("#1F3864");
    expect(html).toContain("#2E75B6");
  });
});
