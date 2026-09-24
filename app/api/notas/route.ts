// Rodada de correção de achado crítico de segurança — mesmo raciocínio de
// app/api/clientes/route.ts: exigirSessao() nos dois métodos,
// supabaseAdmin() no lugar de supabaseServer() (RLS nunca autoriza um
// login que não passa pelo Supabase Auth).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";

const NotaSchema = z.object({
  cliente_id: z.string().uuid(),
  competencia: z.string(), // "2026-08-01"
  numero_nf: z.string().optional(),
  valor: z.number().positive(),
  data_emissao: z.string().optional()
});

export async function GET(req: NextRequest) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const status = req.nextUrl.searchParams.get("status");
  const supabase = supabaseAdmin();
  let query = supabase
    .from("nota_fiscal")
    .select("*, cliente:cliente_id ( nome, uf, sistema_portal, portal_url )")
    .order("data_emissao", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ notas: data });
}

export async function POST(req: NextRequest) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const parsed = NotaSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("nota_fiscal")
    .insert({ ...parsed.data, status: "aguardando_atesto" })
    .select("id")
    .single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
