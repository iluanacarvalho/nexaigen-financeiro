// Tradução ÚNICA do resultado do serviço do CRM (lib/crmServico.ts) em HTTP
// (rodada 16-A), e o escopo de leitura a partir da sessão.
//   nao_encontrado → 404 (inclusive lead de COLEGA: não existe pra quem não
//   é o vendedor — nunca 403, pra não permitir enumeração) · duplicado /
//   ja_cliente / conflito → 409 · dados_invalidos → 400 (formato de
//   `detalhes` do projeto) · proibido → 403.

import { NextResponse } from "next/server";
import type { ContextoAutenticado } from "./auth";
import type { EscopoCrm } from "./crmRepositorio";
import type { FalhaCrm } from "./crmServico";

export const LEAD_NAO_ENCONTRADO = "Lead não encontrado.";

export function escopoDe(contexto: ContextoAutenticado): EscopoCrm {
  return { equipeId: contexto.equipeId, admin: contexto.papel === "admin" };
}

export function respostaDeFalha(f: FalhaCrm, naoEncontrado = LEAD_NAO_ENCONTRADO): NextResponse {
  switch (f.motivo) {
    case "nao_encontrado":
      return NextResponse.json({ erro: naoEncontrado }, { status: 404 });
    case "duplicado":
      return NextResponse.json({ erro: f.erro, duplicado: f.duplicado }, { status: 409 });
    case "ja_cliente":
    case "conflito":
      return NextResponse.json({ erro: f.erro }, { status: 409 });
    case "proibido":
      return NextResponse.json({ erro: f.erro }, { status: 403 });
    case "dados_invalidos":
      return NextResponse.json({ erro: "Dados inválidos", detalhes: { formErrors: f.campo ? [] : [f.erro], fieldErrors: f.campo ? { [f.campo]: [f.erro] } : {} } }, { status: 400 });
  }
}
