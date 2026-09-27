// Exige sessão (lib/auth.ts#exigirSessao) desde a rodada de correção do
// achado crítico de segurança. Postgres direto via lib/db.ts desde a
// rodada de migração de infraestrutura (Supabase → pg).
//
// GET — o embed aninhado do Supabase (`cliente:cliente_id ( nome, uf,
// sistema_portal, portal_url )`) vira um JOIN + `json_build_object(...)
// as cliente` em SQL puro: o driver "pg" já devolve colunas json/jsonb
// como objeto JS automaticamente (sem type parser nenhum necessário pra
// isso, diferente de date/timestamptz/bigint — ver lib/db.ts), então
// `nota.cliente.nome` etc. no frontend (app/(protegido)/checagem)
// continua funcionando idêntico, sem mudar o formato da resposta.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";

const NotaSchema = z.object({
  cliente_id: z.string().uuid(),
  competencia: z.string(), // "2026-08-01"
  numero_nf: z.string().optional(),
  valor: z.number().positive(),
  data_emissao: z.string().optional()
});

const SELECT_NOTAS = `
  select
    nf.*,
    json_build_object('nome', c.nome, 'uf', c.uf, 'sistema_portal', c.sistema_portal, 'portal_url', c.portal_url) as cliente
  from nota_fiscal nf
  join cliente_prefeitura c on c.id = nf.cliente_id
`;

export async function GET(req: NextRequest) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const status = req.nextUrl.searchParams.get("status");
  const notas = status
    ? await query(`${SELECT_NOTAS} where nf.status = $1 order by nf.data_emissao desc`, [status])
    : await query(`${SELECT_NOTAS} order by nf.data_emissao desc`);

  return NextResponse.json({ notas });
}

export async function POST(req: NextRequest) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const parsed = NotaSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  const n = parsed.data;

  // status: "aguardando_atesto" — igual à rota Supabase original.
  const linhas = await query<{ id: string }>(
    n.data_emissao
      ? `insert into nota_fiscal (cliente_id, competencia, numero_nf, valor, data_emissao, status)
         values ($1, $2, $3, $4, $5, 'aguardando_atesto') returning id`
      : `insert into nota_fiscal (cliente_id, competencia, numero_nf, valor, status)
         values ($1, $2, $3, $4, 'aguardando_atesto') returning id`,
    n.data_emissao
      ? [n.cliente_id, n.competencia, n.numero_nf ?? null, n.valor, n.data_emissao]
      : [n.cliente_id, n.competencia, n.numero_nf ?? null, n.valor]
  );
  return NextResponse.json({ id: linhas[0].id });
}
