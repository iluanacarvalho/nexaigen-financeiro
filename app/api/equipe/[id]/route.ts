// Mudar o papel de uma pessoa da equipe (rodada 15-A). SÓ ADMIN
// (exigirPapel área "equipe"). PATCH { papel } → 200 { papel, mudou,
// sessaoEncerrada }. Mudar o papel encerra as sessões da pessoa
// (token_version + sessao revogada — lib/equipeServico.ts): ela entra de
// novo já com o acesso novo. Se for a própria pessoa logada,
// sessaoEncerrada: true avisa a tela pra mandar pro /login.
// 400 papel inválido · 404 pessoa inexistente · 409 tirar o papel de
// admin do último admin ativo.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { alterarPapel } from "@/lib/equipeServico";
import { PAPEIS } from "@/lib/papeis";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

const AlterarPapelSchema = z.strictObject({
  papel: z.enum(PAPEIS, { error: `Papel inválido — use um destes: ${PAPEIS.join(", ")}.` })
});

const NAO_ENCONTRADA = "Pessoa da equipe não encontrada.";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "equipe");
  if (negado) return negado;

  const { id } = await params;
  const parsed = AlterarPapelSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: NAO_ENCONTRADA }, { status: 404 });

  const r = await alterarPapel(id, parsed.data.papel);
  if (r.ok) return NextResponse.json({ papel: r.papel, mudou: r.mudou, sessaoEncerrada: r.mudou && id === contexto!.equipeId });
  if (r.motivo === "nao_encontrado") return NextResponse.json({ erro: NAO_ENCONTRADA }, { status: 404 });
  return NextResponse.json(
    { erro: "Não é possível tirar o papel de administrador do último administrador ativo — promova outra pessoa a administrador antes." },
    { status: 409 }
  );
}
