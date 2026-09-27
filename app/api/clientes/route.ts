// Exige sessão (lib/auth.ts#exigirSessao) desde a rodada de correção do
// achado crítico de segurança — esta rota (dado de cliente real: CNPJ,
// valor mensal, contato) chegou a ficar completamente aberta. Postgres
// direto via lib/db.ts desde a rodada de migração de infraestrutura
// (Supabase → pg, mesma arquitetura do nexaigen-educa) — mesmo
// comportamento de antes, só troca COMO o dado é lido/escrito.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";

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

export async function GET(req: NextRequest) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const clientes = await query(`select * from cliente_prefeitura order by nome`);
  return NextResponse.json({ clientes });
}

export async function POST(req: NextRequest) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const parsed = ClienteSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  const c = parsed.data;

  const linhas = await query<{ id: string }>(
    `insert into cliente_prefeitura
       (nome, uf, cnpj, plano, valor_mensal, dia_vencimento_contrato, data_inicio_contrato,
        sistema_portal, portal_url, portal_usuario, contato_nome, contato_email, contato_telefone)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning id`,
    [
      c.nome,
      c.uf,
      c.cnpj ?? null,
      c.plano,
      c.valor_mensal,
      c.dia_vencimento_contrato,
      c.data_inicio_contrato,
      c.sistema_portal ?? null,
      c.portal_url ?? null,
      c.portal_usuario ?? null,
      c.contato_nome ?? null,
      c.contato_email ?? null,
      c.contato_telefone ?? null
    ]
  );
  return NextResponse.json({ id: linhas[0].id });
}
