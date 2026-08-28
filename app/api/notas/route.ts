import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const NotaSchema = z.object({
  cliente_id: z.string().uuid(),
  competencia: z.string(), // "2026-08-01"
  numero_nf: z.string().optional(),
  valor: z.number().positive(),
  data_emissao: z.string().optional()
});

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const supabase = await supabaseServer();
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
  const parsed = NotaSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("nota_fiscal")
    .insert({ ...parsed.data, status: "aguardando_atesto" })
    .select("id")
    .single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
