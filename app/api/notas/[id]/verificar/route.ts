// Ação central da "fila de checagem" (Seção do README): alguém do time
// entra no portal da prefeitura, confere o status, e registra o que viu
// aqui. Isso alimenta tanto o histórico (evento_verificacao) quanto o
// estado real da nota (data_atesto / data_pagamento), e resolve alertas
// que não fazem mais sentido.
//
// Exige sessão (lib/auth.ts#exigirSessao) desde a rodada de correção do
// achado crítico de segurança — `verificado_por` vem SEMPRE de
// contexto.equipeId (a sessão autenticada), nunca aceito no corpo da
// requisição (achado daquela rodada: antes vinha de
// `z.string().uuid().optional()` no corpo, sem checar contra quem de
// fato chamou). Postgres direto via lib/db.ts desde a rodada de migração
// de infraestrutura (Supabase → pg).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
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
  const { resultado, data_evento, observacao } = parsed.data;

  await query(
    `insert into evento_verificacao (nota_fiscal_id, resultado, observacao, verificado_por) values ($1, $2, $3, $4)`,
    [id, resultado, observacao ?? null, contexto!.equipeId]
  );

  if (resultado === "atestada") {
    const dataEvento = data_evento ?? new Date().toISOString().slice(0, 10);
    await query(`update nota_fiscal set data_atesto = $1, status = 'atestada' where id = $2`, [dataEvento, id]);
    await query(
      `update alerta_cobranca set status = 'resolvido', resolvido_em = now()
       where nota_fiscal_id = $1 and tipo = 'sem_atesto_prolongado' and status <> 'resolvido'`,
      [id]
    );
  }

  if (resultado === "paga") {
    const dataEvento = data_evento ?? new Date().toISOString().slice(0, 10);
    await query(`update nota_fiscal set data_pagamento = $1, status = 'paga' where id = $2`, [dataEvento, id]);
    await query(`update alerta_cobranca set status = 'resolvido', resolvido_em = now() where nota_fiscal_id = $1 and status <> 'resolvido'`, [
      id
    ]);
  }

  return NextResponse.json({ ok: true });
}
