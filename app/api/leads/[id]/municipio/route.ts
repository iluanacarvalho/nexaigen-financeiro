// CRM — vincular um lead ANTIGO (sem código IBGE) ao município da base
// territorial (rodada 16-A3). Área "crm"; dono do lead ou admin (lead de
// colega → 404, como todo o CRM). POST { versao, codigo_ibge } → { versao }.
// 400 município fora da base ou de outra UF · 409 versão velha, lead já
// vinculado ou outro lead aberto do mesmo município. Grava no histórico.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { VincularMunicipioSchema } from "@/lib/crmSchemas";
import { vincularMunicipio } from "@/lib/crmServico";
import { LEAD_NAO_ENCONTRADO, escopoDe, respostaDeFalha } from "@/lib/crmHttp";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const { id } = await params;
  const parsed = VincularMunicipioSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: LEAD_NAO_ENCONTRADO }, { status: 404 });
  const r = await vincularMunicipio(id, parsed.data.codigo_ibge, parsed.data.versao, escopoDe(contexto!));
  return r.ok ? NextResponse.json({ versao: r.versao }) : respostaDeFalha(r);
}
