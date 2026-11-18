// CRM — um lead (rodada 16-A). Área "crm". Lead fora do escopo (vendas
// olhando lead de colega) responde 404, igual a lead inexistente — a
// leitura mínima de leads de colegas é SÓ GET /api/leads/consulta.
//
// GET   → { lead (completo + selos), historico (mais recente primeiro) }
// PATCH { versao, ...campos cadastrais } → { versao, alterados }. Versão
//       diferente da atual → 409 "alguém alterou este lead, recarregue".
//       Etapa, vendedor e motivo de perda NÃO mudam por aqui (objeto estrito).

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { EditarLeadSchema } from "@/lib/crmSchemas";
import { obterLead } from "@/lib/crmRepositorio";
import { editarLead, type DadosLead } from "@/lib/crmServico";
import { LEAD_NAO_ENCONTRADO, escopoDe, respostaDeFalha } from "@/lib/crmHttp";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ erro: LEAD_NAO_ENCONTRADO }, { status: 404 });
  const lead = await obterLead(id, escopoDe(contexto!), hojeEmSaoPaulo(new Date()));
  if (!lead) return NextResponse.json({ erro: LEAD_NAO_ENCONTRADO }, { status: 404 });
  const { historico, ...dados } = lead;
  return NextResponse.json({ lead: dados, historico }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const { id } = await params;
  const parsed = EditarLeadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: LEAD_NAO_ENCONTRADO }, { status: 404 });

  const { versao, valor_mensal_estimado, ...resto } = parsed.data;
  const campos: Partial<DadosLead> = { ...resto };
  if (valor_mensal_estimado !== undefined) campos.valor_mensal_estimado_centavos = valor_mensal_estimado;
  const r = await editarLead(id, campos, versao!, escopoDe(contexto!));
  return r.ok ? NextResponse.json({ versao: r.versao, alterados: r.alterados }) : respostaDeFalha(r);
}
