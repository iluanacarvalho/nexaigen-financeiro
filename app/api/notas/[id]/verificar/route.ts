// Ação central da "fila de checagem" (Seção do README): alguém do time
// entra no portal da prefeitura, confere o status, e registra o que viu
// aqui. Isso alimenta tanto o histórico (evento_verificacao) quanto o
// estado real da nota (data_atesto / data_pagamento), e resolve alertas
// que não fazem mais sentido.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const VerificacaoSchema = z.object({
  resultado: z.enum(["sem_atesto_ainda", "atestada", "paga", "erro_acesso_portal"]),
  data_evento: z.string().optional(), // data em que o atesto/pagamento realmente ocorreu, se souber
  observacao: z.string().optional(),
  verificado_por: z.string().uuid().optional()
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const parsed = VerificacaoSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const supabase = supabaseServer();
  const { resultado, data_evento, observacao, verificado_por } = parsed.data;

  await supabase.from("evento_verificacao").insert({
    nota_fiscal_id: params.id,
    resultado,
    observacao,
    verificado_por: verificado_por ?? null
  });

  if (resultado === "atestada") {
    await supabase
      .from("nota_fiscal")
      .update({ data_atesto: data_evento ?? new Date().toISOString().slice(0, 10), status: "atestada" })
      .eq("id", params.id);
    await supabase
      .from("alerta_cobranca")
      .update({ status: "resolvido", resolvido_em: new Date().toISOString() })
      .eq("nota_fiscal_id", params.id)
      .eq("tipo", "sem_atesto_prolongado")
      .neq("status", "resolvido");
  }

  if (resultado === "paga") {
    await supabase
      .from("nota_fiscal")
      .update({ data_pagamento: data_evento ?? new Date().toISOString().slice(0, 10), status: "paga" })
      .eq("id", params.id);
    await supabase
      .from("alerta_cobranca")
      .update({ status: "resolvido", resolvido_em: new Date().toISOString() })
      .eq("nota_fiscal_id", params.id)
      .neq("status", "resolvido");
  }

  return NextResponse.json({ ok: true });
}
