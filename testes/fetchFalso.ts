// Helper SÓ de teste de componente: substitui o fetch global por um que
// responde por rota (método + início da URL) e registra as chamadas — a
// tela conversa com "a API" sem servidor nenhum. Rota não prevista →
// 599, pra o teste quebrar de forma visível em vez de seguir com dado vazio.

import { vi } from "vitest";

type Resposta = { status?: number; corpo?: unknown } | ((url: string, init?: RequestInit) => { status?: number; corpo?: unknown });

export interface ChamadaFetch {
  metodo: string;
  url: string;
  corpo: unknown;
}

export function instalarFetchFalso(rotas: Record<string, Resposta>): ChamadaFetch[] {
  const chamadas: ChamadaFetch[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
      const metodo = (init?.method ?? "GET").toUpperCase();
      const corpo = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null;
      chamadas.push({ metodo, url, corpo });
      const chave = Object.keys(rotas)
        .filter((k) => {
          const [m, prefixo] = k.split(" ");
          return m === metodo && url.startsWith(prefixo);
        })
        .sort((a, b) => b.length - a.length)[0];
      const definida = chave ? rotas[chave] : { status: 599, corpo: { erro: `rota não prevista no teste: ${metodo} ${url}` } };
      const r = typeof definida === "function" ? definida(url, init) : definida;
      return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
    })
  );
  return chamadas;
}
