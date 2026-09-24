// Ação central da "fila de checagem" (Seção do README): alguém do time
// entra no portal da prefeitura, confere o status, e registra o que viu
// aqui. Isso alimenta tanto o histórico (evento_verificacao) quanto o
// estado real da nota (data_atesto / data_pagamento), e resolve alertas
// que não fazem mais sentido.
//
// Rodada de correção de achado crítico de segurança — mesmo raciocínio
// de app/api/clientes/route.ts: exigirSessao(), supabaseAdmin(). Achado
// ADICIONAL nesta rota especificamente: `verificado_por` vinha do CORPO
// da requisição (`z.string().uuid().optional()`, nunca validado contra
// quem de fato chamou) — qualquer um podia dizer que foi outra pessoa
// que verificou. Agora vem SEMPRE de contexto.equipeId (a própria sessão
// autenticada), nunca mais aceito no corpo — mesmo princípio já aplicado
// em toda rota administrativa do projeto irmão nexaigen-educa (nunca
// confiar em identidade vinda do cliente quando existe uma sessão real
// pra derivar isso).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";

const VerificacaoSchema = z.object({
  resultado: z.enum(["sem_atesto_ainda", "atestada", "paga", "erro_acesso_portal"]),
  data_evento: z.string().optional(), // data em que o atesto/pagamento realmente ocorreu, se souber
  observacao: z.string().optional()
});

// UPGRADE Next.js 16: `params` de route handlers dinâmicos (aqui, [id]) virou
// Promise a partir do Next 15 — precisa dar await antes de usar.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirSessao(contexto);
  if (negado) return negado;

  const parsed = VerificacaoSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const { id } = await params;
  const supabase = supabaseAdmin();
  const { resultado, data_evento, observacao } = parsed.data;

  await supabase.from("evento_verificacao").insert({
    nota_fiscal_id: id,
    resultado,
    observacao,
    verificado_por: contexto!.equipeId
  });

  if (resultado === "atestada") {
    await supabase
      .from("nota_fiscal")
      .update({ data_atesto: data_evento ?? new Date().toISOString().slice(0, 10), status: "atestada" })
      .eq("id", id);
    await supabase
      .from("alerta_cobranca")
      .update({ status: "resolvido", resolvido_em: new Date().toISOString() })
      .eq("nota_fiscal_id", id)
      .eq("tipo", "sem_atesto_prolongado")
      .neq("status", "resolvido");
  }

  if (resultado === "paga") {
    await supabase
      .from("nota_fiscal")
      .update({ data_pagamento: data_evento ?? new Date().toISOString().slice(0, 10), status: "paga" })
      .eq("id", id);
    await supabase
      .from("alerta_cobranca")
      .update({ status: "resolvido", resolvido_em: new Date().toISOString() })
      .eq("nota_fiscal_id", id)
      .neq("status", "resolvido");
  }

  return NextResponse.json({ ok: true });
}
