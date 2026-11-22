// Contrato GERADO a partir do modelo (rodada 16-B1) — .docx (Word editável).
// Área "contrato_gerado": admin e Contratos (qualquer cliente) e Vendas (só
// o cliente do SEU fechamento — de outro, 404). Usa o modelo APROVADO mais
// recente do plano; sem aprovado, o RASCUNHO mais recente — e aí o
// documento sai com a faixa "RASCUNHO — SEM VALIDADE JURÍDICA" em todas as
// páginas. Registra o evento 'contrato_gerado'. Nada é guardado.
// 409 sem modelo · 422 com a lista dos dados que faltam no cliente.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { TIPO_MIME_DOCX } from "@/lib/docx";
import { gerarContratoDoCliente } from "@/lib/modelosContratoServico";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { ehUuid } from "@/lib/validacao";

const NAO_ENCONTRADO = "Cliente não encontrado.";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "contrato_gerado");
  if (negado) return negado;

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ erro: NAO_ENCONTRADO }, { status: 404 });
  const r = await gerarContratoDoCliente(id, { equipeId: contexto!.equipeId, papel: contexto!.papel }, hojeEmSaoPaulo(new Date()));
  if (!r.ok) {
    if (r.motivo === "nao_encontrado") return NextResponse.json({ erro: NAO_ENCONTRADO }, { status: 404 });
    if (r.motivo === "dados_faltando") return NextResponse.json({ erro: r.erro, faltando: r.faltando }, { status: 422 });
    return NextResponse.json({ erro: r.erro }, { status: 409 });
  }
  return new Response(new Uint8Array(r.arquivo), {
    headers: {
      "content-type": TIPO_MIME_DOCX,
      "content-disposition": `attachment; filename="${r.nomeArquivo}"`,
      "cache-control": "no-store",
      "x-modelo-contrato": `${r.modelo.plano} v${r.modelo.versao} ${r.modelo.status}`
    }
  });
}
