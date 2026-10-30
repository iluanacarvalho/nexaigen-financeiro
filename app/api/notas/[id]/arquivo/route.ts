// Upload/download do PDF da nota fiscal, COM HISTÓRICO DE VERSÕES
// (0005_nota_fiscal_arquivo_versao.sql). Este projeto NÃO emite NF-e — a
// nota já é emitida fora (prefeitura/contador); aqui só se guarda o
// arquivo. Toda a orquestração (bucket + transação + compensação +
// download em streaming) é lib/versionamentoPdf.ts, compartilhada com o
// contrato da prefeitura; esta rota só valida e traduz em HTTP.
//
// POST multipart { arquivo (PDF ≤10MB, assinatura %PDF-), motivo? (≤300) }
//   → { ok, versao, arquivo_pdf_nome, tamanho_bytes, sha256 }.
//   Cada envio é uma versão nova — nada é sobrescrito nem apagado.
//   502 bucket indisponível (nada gravado) · 500 falha ao registrar
//   (objeto recém-enviado removido).
// GET [?versao=N] — download pelo servidor, em streaming (padrão: atual).
//   N inexistente → 404 · N malformado → 400.
//
// Não existe — de propósito — nenhum fluxo de remover PDF.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import { lerPdfDoFormData } from "@/lib/validacaoPdf";
import { lerMotivo, lerParametroVersao } from "@/lib/versaoArquivo";
import { ALVO_PDF_NOTA, donoExiste, localizarPdf, registrarVersaoPdf, respostaDownloadPdf } from "@/lib/versionamentoPdf";
import { ehUuid } from "@/lib/validacao";

const NAO_ENCONTRADA = () => NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirSessao(contexto);
  if (negado) return negado;

  const { id: notaId } = await params;
  if (!ehUuid(notaId) || !(await donoExiste(ALVO_PDF_NOTA, notaId))) return NAO_ENCONTRADA();

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ erro: "Corpo da requisição precisa ser multipart/form-data." }, { status: 400 });

  const pdf = await lerPdfDoFormData(formData);
  if (!pdf.ok) return NextResponse.json({ erro: pdf.erro }, { status: 400 });
  const motivo = lerMotivo(formData.get("motivo"));
  if (!motivo.ok) return NextResponse.json({ erro: motivo.erro }, { status: 400 });

  const r = await registrarVersaoPdf(ALVO_PDF_NOTA, notaId, { buffer: pdf.buffer, nome: pdf.nome, motivo: motivo.motivo, enviadoPor: contexto!.equipeId });
  if (r.ok) return NextResponse.json({ ok: true, versao: r.versao, arquivo_pdf_nome: pdf.nome, tamanho_bytes: r.tamanhoBytes, sha256: r.sha256 });
  if (r.motivo === "bucket") return NextResponse.json({ erro: "Armazenamento indisponível no momento — tente novamente em instantes." }, { status: 502 });
  if (r.motivo === "dono_inexistente") return NAO_ENCONTRADA();
  return NextResponse.json({ erro: "Não foi possível registrar o PDF — tente novamente." }, { status: 500 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirSessao(contexto);
  if (negado) return negado;

  const { id: notaId } = await params;
  const parametro = lerParametroVersao(req.nextUrl.searchParams.get("versao"));
  if (!parametro.ok) return NextResponse.json({ erro: parametro.erro }, { status: 400 });
  if (!ehUuid(notaId)) return NAO_ENCONTRADA();

  const local = await localizarPdf(ALVO_PDF_NOTA, notaId, parametro.versao);
  switch (local.status) {
    case "ok":
      return respostaDownloadPdf(local.chave, local.nome);
    case "dono_inexistente":
      return NAO_ENCONTRADA();
    case "sem_arquivo":
      return NextResponse.json({ erro: "Esta nota fiscal não tem PDF anexado." }, { status: 404 });
    case "versao_inexistente":
      return NextResponse.json({ erro: `Versão ${parametro.versao} não encontrada para esta nota fiscal.` }, { status: 404 });
  }
}
