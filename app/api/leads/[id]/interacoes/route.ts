// CRM — registrar contato no histórico do lead (rodada 16-A). Área "crm";
// só no lead em que quem chama é o vendedor (ou admin) — senão 404.
// POST { tipo: nota|ligacao|email|reuniao|whatsapp|visita, texto (até 2000) } → 201 { id }
// O histórico é somente acréscimo (trigger da 0014). Nada de dado pessoal
// de cidadão aqui — só informação comercial da prefeitura (aviso na tela).

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { InteracaoSchema } from "@/lib/crmSchemas";
import { registrarInteracao } from "@/lib/crmServico";
import { LEAD_NAO_ENCONTRADO, escopoDe, respostaDeFalha } from "@/lib/crmHttp";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const { id } = await params;
  const parsed = InteracaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: LEAD_NAO_ENCONTRADO }, { status: 404 });
  const r = await registrarInteracao(id, parsed.data, escopoDe(contexto!));
  return r.ok ? NextResponse.json({ id: r.interacaoId }, { status: 201 }) : respostaDeFalha(r);
}
