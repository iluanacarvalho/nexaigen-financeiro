// GET /api/notas/[id]/arquivo/versoes — histórico de versões do PDF da
// nota fiscal (db/migrations/0005_nota_fiscal_arquivo_versao.sql), da mais
// recente pra mais antiga. `atual` = a versão para a qual
// nota_fiscal.arquivo_pdf_chave aponta hoje (chave é única por versão).
// Exige sessão da equipe. Da pessoa que enviou, só o NOME (nunca e-mail).
// O download de cada versão é GET /api/notas/[id]/arquivo?versao=N.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import type { VersaoArquivoNota } from "@/lib/tipos";


export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const { id: notaId } = await params;
  if (!z.string().uuid().safeParse(notaId).success) return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });

  const notas = await query<{ id: string }>(`select id from nota_fiscal where id = $1`, [notaId]);
  if (notas.length === 0) return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });

  const versoes = await query<VersaoArquivoNota>(
    `select
       v.versao, v.nome, v.tamanho_bytes, v.sha256, v.enviado_em, v.motivo,
       e.nome as enviado_por_nome,
       coalesce(v.chave = nf.arquivo_pdf_chave, false) as atual
     from nota_fiscal_arquivo_versao v
     join nota_fiscal nf on nf.id = v.nota_fiscal_id
     left join equipe_nexaigen e on e.id = v.enviado_por
     where v.nota_fiscal_id = $1
     order by v.versao desc`,
    [notaId]
  );

  return NextResponse.json({ versoes });
}
