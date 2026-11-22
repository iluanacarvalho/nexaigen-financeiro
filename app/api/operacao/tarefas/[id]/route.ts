// Agir numa tarefa (rodada 16-B1). Área "operacao".
// POST { acao: "assumir" } | { acao: "devolver" } | { acao: "concluir", observacao? }
//    | { acao: "prazo", prazo } (só admin) | { acao: "cancelar", motivo } (só admin)
//   → { status }. Tarefa de OUTRO papel → 404 (filtro no SQL). 409: já
//   assumida por outra pessoa, já concluída/cancelada, assinatura (conclui
//   sozinha). 403: prazo/cancelar sem ser admin, devolver/concluir tarefa de outra pessoa.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { AcaoTarefaSchema } from "@/lib/fechamentoSchemas";
import { agirNaTarefa } from "@/lib/tarefasServico";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

const NAO_ENCONTRADA = "Tarefa não encontrada.";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "operacao");
  if (negado) return negado;

  const { id } = await params;
  const parsed = AcaoTarefaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: NAO_ENCONTRADA }, { status: 404 });
  const r = await agirNaTarefa(id, parsed.data, { equipeId: contexto!.equipeId, papel: contexto!.papel });
  if (r.ok) return NextResponse.json({ status: r.status });
  if (r.motivo === "nao_encontrado") return NextResponse.json({ erro: NAO_ENCONTRADA }, { status: 404 });
  return NextResponse.json({ erro: r.erro }, { status: r.motivo === "proibido" ? 403 : 409 });
}
