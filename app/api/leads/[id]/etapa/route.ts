// CRM — mudar a etapa do lead (rodada 16-A). Área "crm"; só no lead em que
// quem chama é o vendedor (ou admin) — senão 404. Etapa + linha no histórico
// na MESMA transação (lib/crmServico.ts#mudarEtapa).
// POST { acao: "mover", etapa } | { acao: "perder", motivo, detalhe? } | { acao: "reabrir" }
//   → { etapa, versao }. Entre etapas abertas: avança ou volta. Perder exige
//   motivo. De 'perdido' só reabrir (volta pra 'contato', histórico "reabertura").
//   'ganho' → 409: só o REGISTRO DO ACEITE grava 'ganho' (16-B1, POST /api/leads/[id]/aceite) — não há atalho aqui.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { EtapaSchema } from "@/lib/crmSchemas";
import { mudarEtapa } from "@/lib/crmServico";
import { LEAD_NAO_ENCONTRADO, escopoDe, respostaDeFalha } from "@/lib/crmHttp";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const { id } = await params;
  const parsed = EtapaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: LEAD_NAO_ENCONTRADO }, { status: 404 });
  const acao = parsed.data.acao === "perder" ? { ...parsed.data, detalhe: parsed.data.detalhe ?? null } : parsed.data;
  const r = await mudarEtapa(id, acao, escopoDe(contexto!));
  return r.ok ? NextResponse.json({ etapa: r.etapa, versao: r.versao }) : respostaDeFalha(r);
}
