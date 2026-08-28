import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("alerta_cobranca")
    .select(
      "*, nota:nota_fiscal_id ( numero_nf, valor, data_limite_pagamento, cliente:cliente_id ( nome, uf, contato_email, contato_telefone ) )"
    )
    .neq("status", "resolvido")
    .order("gerado_em", { ascending: false });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ alertas: data });
}
