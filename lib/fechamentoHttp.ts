// Tradução ÚNICA dos resultados do fechamento (rodada 16-B1) em HTTP:
// nao_encontrado → 404 (inclusive lead/cliente/tarefa de outra pessoa ou de
// outro papel: "não existe", nunca 403) · conflito → 409 · dados_invalidos →
// 400 no formato `detalhes` do projeto · proibido → 403 · bucket → 502 (a
// mesma mensagem de sempre do armazenamento) · banco → 500.

import { NextResponse } from "next/server";

type Falha =
  | { ok: false; motivo: "nao_encontrado" }
  | { ok: false; motivo: "conflito" | "dados_invalidos" | "proibido" | "bucket" | "banco"; erro: string; campo?: string };

const STATUS = { conflito: 409, dados_invalidos: 400, proibido: 403, bucket: 502, banco: 500 } as const;

export function respostaDeFalhaFechamento(f: Falha, naoEncontrado: string): NextResponse {
  if (f.motivo === "nao_encontrado") return NextResponse.json({ erro: naoEncontrado }, { status: 404 });
  if (f.motivo === "dados_invalidos") {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: { formErrors: f.campo ? [] : [f.erro], fieldErrors: f.campo ? { [f.campo]: [f.erro] } : {} } }, { status: 400 });
  }
  return NextResponse.json({ erro: f.erro }, { status: STATUS[f.motivo] });
}
