import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const ClienteSchema = z.object({
  nome: z.string().min(3),
  uf: z.string().length(2),
  cnpj: z.string().optional(),
  plano: z.enum(["essencial", "completo"]).default("essencial"),
  valor_mensal: z.number().positive(),
  dia_vencimento_contrato: z.number().int().min(1).max(28).default(1),
  data_inicio_contrato: z.string(),
  sistema_portal: z.string().optional(),
  portal_url: z.string().url().optional(),
  portal_usuario: z.string().optional(),
  contato_nome: z.string().optional(),
  contato_email: z.string().email().optional(),
  contato_telefone: z.string().optional()
});

export async function GET() {
  const supabase = supabaseServer();
  const { data, error } = await supabase.from("cliente_prefeitura").select("*").order("nome");
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ clientes: data });
}

export async function POST(req: NextRequest) {
  const parsed = ClienteSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const supabase = supabaseServer();
  const { data, error } = await supabase.from("cliente_prefeitura").insert(parsed.data).select("id").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
