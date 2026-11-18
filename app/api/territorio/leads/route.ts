// Criar leads a partir do Território (rodada 16-A2) — "Abrir lead" (um
// município), "Criar leads para os selecionados" e "todas as ainda não
// abordadas" (da entidade ou dos resultados filtrados). Área "crm".
// POST { acao: "previa" | "criar", alvo, vendedor_id? (só admin) }
//   alvo = { modo: "selecao", codigos: [...] }
//        | { modo: "nao_abordados", filtros: {…da URL…}, entidade_id? }
// previa → 200 { criar, pulados } (nada gravado)
// criar  → 201 { criados, pulados } — UMA transação (lib/territorioServico.ts);
//          duplicados e clientes vigentes são PULADOS e listados.
// 403: vendas atribuindo a outro vendedor · 404: entidade inexistente/não visível.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { escopoDe, respostaDeFalha } from "@/lib/crmHttp";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { obterNomeEntidadeVisivel } from "@/lib/territorioRepositorio";
import { LoteSchema } from "@/lib/territorioSchemas";
import { criarLeadsEmLote, previaLote, type AlvoLote } from "@/lib/territorioServico";
import { ENTIDADE_NAO_ENCONTRADA } from "@/lib/territorioHttp";
import { detalhesDoErro } from "@/lib/validacao";

export async function POST(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const parsed = LoteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const { acao, alvo: entrada, vendedor_id } = parsed.data;
  const leitor = escopoDe(contexto!);
  const hoje = hojeEmSaoPaulo(new Date());

  let alvo: AlvoLote;
  if (entrada.modo === "selecao") alvo = { modo: "selecao", codigos: entrada.codigos };
  else {
    let entidadeNome: string | undefined;
    if (entrada.entidade_id) {
      const nome = await obterNomeEntidadeVisivel(entrada.entidade_id, leitor);
      if (nome === null) return NextResponse.json({ erro: ENTIDADE_NAO_ENCONTRADA }, { status: 404 });
      entidadeNome = nome;
    }
    alvo = { modo: "nao_abordados", filtros: entrada.filtros, entidadeId: entrada.entidade_id, entidadeNome };
  }

  if (acao === "previa") {
    if (vendedor_id && !leitor.admin && vendedor_id !== leitor.equipeId) return NextResponse.json({ erro: "Só um administrador cria leads para outro vendedor." }, { status: 403 });
    return NextResponse.json(await previaLote(alvo, leitor, hoje), { headers: { "cache-control": "no-store" } });
  }
  const r = await criarLeadsEmLote(alvo, vendedor_id, leitor, hoje);
  return r.ok ? NextResponse.json({ criados: r.criados, pulados: r.pulados }, { status: 201 }) : respostaDeFalha(r);
}
