// CRM — trocar o vendedor de um lead (rodada 16-A). SÓ ADMIN: área
// "crm_gestao" (lib/papeis.ts). Histórico 'troca_vendedor' na mesma transação.
// POST { vendedor_id } → { versao }. O novo vendedor precisa estar ativo e
// ter papel vendas ou admin (400); mesmo vendedor → 409.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { VendedorSchema } from "@/lib/crmSchemas";
import { trocarVendedor } from "@/lib/crmServico";
import { LEAD_NAO_ENCONTRADO, escopoDe, respostaDeFalha } from "@/lib/crmHttp";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm_gestao");
  if (negado) return negado;

  const { id } = await params;
  const parsed = VendedorSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: LEAD_NAO_ENCONTRADO }, { status: 404 });
  const r = await trocarVendedor(id, parsed.data.vendedor_id, escopoDe(contexto!));
  return r.ok ? NextResponse.json({ versao: r.versao }) : respostaDeFalha(r);
}
