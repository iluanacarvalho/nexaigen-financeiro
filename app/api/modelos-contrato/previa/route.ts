// Pré-visualização de um texto de modelo com DADOS DE EXEMPLO (rodada
// 16-B1). SÓ ADMIN (área "modelos_contrato"). POST { plano, conteudo } →
// { ok, texto, faixa, rodape } ou 400 com os campos desconhecidos — nada é gravado.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { dadosDeExemplo, faixaDeRascunho, renderizarModelo, rodapeDoContrato, textoDosBlocos, validarModelo } from "@/lib/contratoModelo";
import { PreviaModeloSchema } from "@/lib/fechamentoSchemas";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { detalhesDoErro } from "@/lib/validacao";

export async function POST(req: NextRequest) {
  const negado = exigirPapel(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value), "modelos_contrato");
  if (negado) return negado;

  const parsed = PreviaModeloSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const v = validarModelo(parsed.data.conteudo);
  if (!v.ok) return NextResponse.json({ erro: "Dados inválidos", detalhes: { formErrors: [], fieldErrors: { conteudo: v.erros } } }, { status: 400 });
  const hoje = hojeEmSaoPaulo(new Date());
  const r = renderizarModelo(parsed.data.conteudo, dadosDeExemplo(parsed.data.plano, hoje));
  if (!r.ok) return NextResponse.json({ erro: `Faltam dados: ${r.faltando.join("; ")}` }, { status: 400 });
  const usado = { plano: parsed.data.plano, versao: 0, status: "rascunho" as const };
  return NextResponse.json({ ok: true, texto: textoDosBlocos(r.blocos), faixa: faixaDeRascunho(usado), rodape: rodapeDoContrato(usado, hoje) });
}
