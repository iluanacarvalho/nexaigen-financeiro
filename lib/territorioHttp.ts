// Tradução dos resultados de entidades/visões em HTTP (rodada 16-A2), no
// mesmo formato do CRM (lib/crmHttp.ts): nao_encontrado → 404 · conflito →
// 409 · dados_invalidos → 400 com `detalhes` do projeto.

import { NextResponse } from "next/server";

export const ENTIDADE_NAO_ENCONTRADA = "Entidade não encontrada.";

export function respostaDeFalhaSimples(
  f: { ok: false; motivo: "nao_encontrado" } | { ok: false; motivo: "conflito" | "dados_invalidos"; erro: string; campo?: string },
  naoEncontrado: string
): NextResponse {
  if (f.motivo === "nao_encontrado") return NextResponse.json({ erro: naoEncontrado }, { status: 404 });
  if (f.motivo === "conflito") return NextResponse.json({ erro: f.erro }, { status: 409 });
  return NextResponse.json({ erro: "Dados inválidos", detalhes: { formErrors: f.campo ? [] : [f.erro], fieldErrors: f.campo ? { [f.campo]: [f.erro] } : {} } }, { status: 400 });
}

/** URLSearchParams → objeto simples (o primeiro valor de cada chave), sem o que a rota usa pra si. */
export function parametrosDaUrl(params: URLSearchParams, sem: string[] = []): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [k, v] of params) if (!sem.includes(k) && !(k in saida)) saida[k] = v;
  return saida;
}
