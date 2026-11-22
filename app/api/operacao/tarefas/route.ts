// Tarefas operacionais (rodada 16-B1). Área "operacao" (Contratos,
// Implantação, admin). GET ?aba=minhas|fila|todas|atrasadas
//   → { tarefas, contagem: { abertas, atrasadas, minhas } }
// Cada pessoa vê SÓ as tarefas do SEU papel (filtro no SQL —
// lib/tarefasServico.ts); "todas" e "atrasadas" só admin (403 pros outros).

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { ListarTarefasSchema } from "@/lib/fechamentoSchemas";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { contarTarefas, listarTarefas } from "@/lib/tarefasServico";
import { detalhesDoErro } from "@/lib/validacao";

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "operacao");
  if (negado) return negado;

  const parsed = ListarTarefasSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ erro: "Filtros inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const leitor = { equipeId: contexto!.equipeId, papel: contexto!.papel };
  if ((parsed.data.aba === "todas" || parsed.data.aba === "atrasadas") && leitor.papel !== "admin") {
    return NextResponse.json({ erro: "Só administrador vê todas as tarefas." }, { status: 403 });
  }
  const hoje = hojeEmSaoPaulo(new Date());
  const [tarefas, contagem] = await Promise.all([listarTarefas(parsed.data.aba, leitor, hoje), contarTarefas(leitor, hoje)]);
  return NextResponse.json({ tarefas, contagem }, { headers: { "cache-control": "no-store" } });
}
