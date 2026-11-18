// proxy.ts e next.config.js (rodada 15-B): cabeçalhos de iframe/segurança.
//   - /mapa: CSP montada em TEMPO DE EXECUÇÃO com MAPA_PUBLICO_ORIGENS;
//     o proxy NUNCA redireciona (nem pra /login) — só acrescenta cabeçalhos;
//   - matcher só /mapa (a API pública e o resto do app não passam por ele);
//   - next.config.js: o resto do app inteiro recusa iframe (DENY +
//     frame-ancestors 'none'), e a regra NÃO pega /mapa.

import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

const ORIGINAL = process.env.MAPA_PUBLICO_ORIGENS;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MAPA_PUBLICO_ORIGENS;
  else process.env.MAPA_PUBLICO_ORIGENS = ORIGINAL;
});

describe("proxy.ts", () => {
  it("/mapa: segue adiante (nunca redireciona pra /login) e põe CSP com as origens lidas AGORA", () => {
    process.env.MAPA_PUBLICO_ORIGENS = "https://www.nexaigen.com.br";
    const res = proxy();
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'self' https://www.nexaigen.com.br");
    expect(res.headers.get("x-frame-options")).toBeNull();

    process.env.MAPA_PUBLICO_ORIGENS = "";
    expect(proxy().headers.get("content-security-policy")).toMatch(/frame-ancestors 'self'$/);
  });

  it("matcher: só /mapa (a API pública e as páginas internas não passam pelo proxy)", () => {
    expect(config.matcher).toBe("/mapa");
    // O argumento da requisição não é usado: o proxy não depende de cookie/sessão nenhuma.
    expect(proxy.length).toBe(0);
    expect(new NextRequest("http://localhost:3001/mapa").nextUrl.pathname).toBe("/mapa");
  });
});

describe("next.config.js — anti-iframe no resto do app", () => {
  it("uma regra DENY + frame-ancestors 'none' que casa com tudo MENOS /mapa", async () => {
    const nextConfig = (await import("./next.config.js")).default as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    const regras = await nextConfig.headers();
    expect(regras).toHaveLength(1);
    expect(regras[0].headers).toEqual([
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }
    ]);
    // Mesmo padrão path-to-regexp que o Next usa: /:caminho((?!mapa$).*)
    const casa = (caminho: string) => new RegExp(`^/(?!mapa$).*$`).test(caminho);
    expect(regras[0].source).toBe("/:caminho((?!mapa$).*)");
    for (const p of ["/", "/login", "/clientes", "/api/publico/mapa-clientes", "/mapa/outra", "/mapas"]) expect(casa(p)).toBe(true);
    expect(casa("/mapa")).toBe(false);
  });
});
