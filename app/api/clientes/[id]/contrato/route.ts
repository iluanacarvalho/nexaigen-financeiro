// Upload/download do PDF do CONTRATO da prefeitura cliente — uso normal
// da equipe (sessão). Mesmo desenho de app/api/notas/[id]/arquivo/route.ts:
// mesmas regras de validação (lib/validacaoPdf.ts — tamanho ≤10MB,
// application/pdf, assinatura `%PDF-`), mesmo módulo de storage
// (lib/armazenamentoObjetos.ts), metadados em
// cliente_prefeitura.contrato_arquivo_chave/contrato_arquivo_nome
// (db/migrations/0004_integracao_educa.sql).
//
// CHAVE: `financeiro/contratos-prefeitura/${clienteId}/${nomeSanitizado}`
// — mesmo prefixo usado por POST /api/integracao/clientes (que usa um
// uuid novo no lugar do clienteId, porque ainda não sabe o id na hora do
// upload). Trocar o contrato deixa o objeto anterior órfão no bucket
// (pendência conhecida, mesma da nota fiscal — ver README).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import * as armazenamentoObjetos from "@/lib/armazenamentoObjetos";
import { TIPO_MIME_PDF, lerPdfDoFormData, sanitizarNomeArquivo } from "@/lib/validacaoPdf";

const idValido = (id: string) => z.string().uuid().safeParse(id).success;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const { id: clienteId } = await params;
  if (!idValido(clienteId)) return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });

  const clientes = await query<{ id: string }>(`select id from cliente_prefeitura where id = $1`, [clienteId]);
  if (clientes.length === 0) return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ erro: "Corpo da requisição precisa ser multipart/form-data." }, { status: 400 });

  const pdf = await lerPdfDoFormData(formData);
  if (!pdf.ok) return NextResponse.json({ erro: pdf.erro }, { status: 400 });

  const chaveObjeto = `financeiro/contratos-prefeitura/${clienteId}/${sanitizarNomeArquivo(pdf.nome)}`;
  const enviado = await armazenamentoObjetos.uploadArquivo(chaveObjeto, pdf.buffer, TIPO_MIME_PDF);
  if (!enviado) {
    return NextResponse.json({ erro: "Armazenamento indisponível no momento — tente novamente em instantes." }, { status: 502 });
  }

  await query(`update cliente_prefeitura set contrato_arquivo_chave = $1, contrato_arquivo_nome = $2 where id = $3`, [
    chaveObjeto,
    pdf.nome,
    clienteId
  ]);

  return NextResponse.json({ ok: true, contrato_arquivo_nome: pdf.nome });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const { id: clienteId } = await params;
  if (!idValido(clienteId)) return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });

  const clientes = await query<{ contrato_arquivo_chave: string | null }>(
    `select contrato_arquivo_chave from cliente_prefeitura where id = $1`,
    [clienteId]
  );
  if (clientes.length === 0) return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });

  const chave = clientes[0].contrato_arquivo_chave;
  if (!chave) return NextResponse.json({ erro: "Este cliente não tem contrato anexado." }, { status: 404 });

  const url = await armazenamentoObjetos.gerarUrlDownload(chave);
  if (!url) return NextResponse.json({ erro: "Armazenamento indisponível no momento — tente novamente em instantes." }, { status: 502 });

  return NextResponse.json({ url });
}
