// Exige sessão (lib/auth.ts#exigirSessao) desde a rodada de correção do
// achado crítico de segurança — expõe contato_email/contato_telefone da
// prefeitura junto com o valor da NF, dado de contato real. Postgres
// direto via lib/db.ts desde a rodada de migração de infraestrutura
// (Supabase → pg).
//
// O embed DUPLAMENTE aninhado do Supabase (alerta → nota:nota_fiscal_id
// { ..., cliente:cliente_id { ... } }) vira um JOIN de 3 tabelas + um
// `json_build_object` aninhado dentro de outro em SQL puro — o de dentro
// (cliente) fica dentro do de fora (nota), reproduzindo exatamente
// `alerta.nota.cliente.nome` que o frontend (app/(protegido)/alertas)
// já espera. Mesmo raciocínio de app/api/notas/route.ts sobre o driver
// "pg" já devolver json/jsonb como objeto JS sem parser nenhum.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const alertas = await query(
    `select
       a.*,
       json_build_object(
         'numero_nf', nf.numero_nf,
         'valor', nf.valor,
         'data_limite_pagamento', nf.data_limite_pagamento,
         'cliente', json_build_object('nome', c.nome, 'uf', c.uf, 'contato_email', c.contato_email, 'contato_telefone', c.contato_telefone)
       ) as nota
     from alerta_cobranca a
     join nota_fiscal nf on nf.id = a.nota_fiscal_id
     join cliente_prefeitura c on c.id = nf.cliente_id
     where a.status <> 'resolvido'
     order by a.gerado_em desc`
  );

  return NextResponse.json({ alertas });
}
