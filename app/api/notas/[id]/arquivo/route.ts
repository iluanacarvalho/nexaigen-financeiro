// Upload/download do PDF da nota fiscal (pedido da Luana) — este projeto
// NÃO emite NF-e, a nota já é emitida fora (prefeitura/contador); aqui só
// guardamos o arquivo já pronto. O ARQUIVO em si vai pro Railway Buckets
// (lib/armazenamentoObjetos.ts — REAPROVEITADO tal e qual do módulo já
// usado pelo projeto irmão nexaigen-educa pra prestação de contas de
// convênio, mesmo padrão de storage, não duplicado), esta rota só
// orquestra: valida, faz upload, grava metadados em
// nota_fiscal.arquivo_pdf_chave/arquivo_pdf_nome
// (db/migrations/0002_nota_fiscal_arquivo_pdf.sql).
//
// VALIDAÇÃO MAIS RIGOROSA que o precedente de convênio em nexaigen-educa
// (que só confere Content-Type + extensão do nome): aqui confere também
// a ASSINATURA REAL do arquivo (`%PDF-` nos 5 primeiros bytes) — um
// Content-Type declarado como application/pdf não garante que o
// conteúdo enviado seja de fato um PDF. Ainda não é um scanner de
// malware/validação de estrutura completa do PDF — só a assinatura
// (magic bytes), suficiente pra recusar um arquivo renomeado/errado sem
// nunca ler o PDF inteiro pra isso.
//
// CHAVE_OBJETO: sempre `financeiro/notas-fiscais/${notaFiscalId}/${nomeSanitizado}`
// — nunca um path dependente só do nome original. Diferente do padrão de
// convênio (que usa um uuid no meio da chave pra nunca colidir entre
// múltiplos anexos da mesma entidade), aqui uma nota fiscal só tem UM
// PDF por vez — reenviar substitui o anterior na mesma chave lógica (o
// nome sanitizado pode mudar entre envios, então a chave antiga fica
// órfã no bucket; ver pendência documentada no README/CLAUDE.md).

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import * as armazenamentoObjetos from "@/lib/armazenamentoObjetos";
// Regras de validação do PDF (tamanho/tipo/assinatura) compartilhadas com
// o contrato da prefeitura (app/api/clientes/[id]/contrato) — ver lib/validacaoPdf.ts.
import { lerPdfDoFormData, sanitizarNomeArquivo } from "@/lib/validacaoPdf";

interface NotaMinima {
  id: string;
}

// UPGRADE Next.js 16: `params` de route handlers dinâmicos virou Promise
// a partir do Next 15 — precisa dar await antes de usar (mesmo padrão já
// usado em app/api/notas/[id]/verificar/route.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirSessao(contexto);
  if (negado) return negado;

  const { id: notaId } = await params;

  const notas = await query<NotaMinima>(`select id from nota_fiscal where id = $1`, [notaId]);
  if (notas.length === 0) return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ erro: "Corpo da requisição precisa ser multipart/form-data." }, { status: 400 });

  const pdf = await lerPdfDoFormData(formData);
  if (!pdf.ok) return NextResponse.json({ erro: pdf.erro }, { status: 400 });
  const { buffer, nome } = pdf;

  const nomeSanitizado = sanitizarNomeArquivo(nome);
  const chaveObjeto = `financeiro/notas-fiscais/${notaId}/${nomeSanitizado}`;

  const enviado = await armazenamentoObjetos.uploadArquivo(chaveObjeto, buffer, "application/pdf");
  if (!enviado) {
    return NextResponse.json({ erro: "Armazenamento indisponível no momento — tente novamente em instantes." }, { status: 502 });
  }

  await query(`update nota_fiscal set arquivo_pdf_chave = $1, arquivo_pdf_nome = $2 where id = $3`, [
    chaveObjeto,
    nome,
    notaId
  ]);

  return NextResponse.json({ ok: true, arquivo_pdf_nome: nome });
}

interface NotaComArquivo {
  arquivo_pdf_chave: string | null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirSessao(contexto);
  if (negado) return negado;

  const { id: notaId } = await params;

  const notas = await query<NotaComArquivo>(`select arquivo_pdf_chave from nota_fiscal where id = $1`, [notaId]);
  if (notas.length === 0) return NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });

  const { arquivo_pdf_chave: chave } = notas[0];
  if (!chave) return NextResponse.json({ erro: "Esta nota fiscal não tem PDF anexado." }, { status: 404 });

  const url = await armazenamentoObjetos.gerarUrlDownload(chave);
  if (!url) return NextResponse.json({ erro: "Armazenamento indisponível no momento — tente novamente em instantes." }, { status: 502 });

  return NextResponse.json({ url });
}
