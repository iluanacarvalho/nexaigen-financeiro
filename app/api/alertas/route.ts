// Rodada de correção de achado crítico de segurança — mesmo raciocínio de
// app/api/clientes/route.ts: exigirSessao(), supabaseAdmin(). Esta rota
// em particular expõe contato_email/contato_telefone da prefeitura junto
// com o valor da NF — dado de contato real, não deveria nunca ter sido
// pública.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const supabase = supabaseAdmin();
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
