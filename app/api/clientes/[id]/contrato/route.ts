// Upload/download do CONTRATO em PDF da prefeitura cliente, COM HISTÓRICO
// DE VERSÕES (0009_cliente_contrato_versao.sql) — mesmo padrão e MESMA
// implementação do PDF da nota fiscal (lib/versionamentoPdf.ts). Exige
// sessão; quem enviou vem da sessão.
//
// POST multipart { arquivo (PDF ≤10MB, assinatura %PDF-), motivo? (≤300) }
//   → { ok, versao, contrato_arquivo_nome, tamanho_bytes, sha256 }.
//   Nada é sobrescrito nem apagado; bucket indisponível → 502 (nada
//   gravado); falha ao registrar → 500 (objeto recém-enviado removido).
// GET [?versao=N] — download pelo servidor, em streaming (padrão: atual).

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import { lerPdfDoFormData } from "@/lib/validacaoPdf";
import { lerMotivo, lerParametroVersao } from "@/lib/versaoArquivo";
import { ALVO_CONTRATO, donoExiste, localizarPdf, registrarVersaoPdf, respostaDownloadPdf } from "@/lib/versionamentoPdf";
import { ehUuid } from "@/lib/validacao";

const NAO_ENCONTRADO = () => NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirSessao(contexto);
  if (negado) return negado;

  const { id: clienteId } = await params;
  if (!ehUuid(clienteId) || !(await donoExiste(ALVO_CONTRATO, clienteId))) return NAO_ENCONTRADO();

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ erro: "Corpo da requisição precisa ser multipart/form-data." }, { status: 400 });

  const pdf = await lerPdfDoFormData(formData);
  if (!pdf.ok) return NextResponse.json({ erro: pdf.erro }, { status: 400 });
  const motivo = lerMotivo(formData.get("motivo"));
  if (!motivo.ok) return NextResponse.json({ erro: motivo.erro }, { status: 400 });

  const r = await registrarVersaoPdf(ALVO_CONTRATO, clienteId, { buffer: pdf.buffer, nome: pdf.nome, motivo: motivo.motivo, enviadoPor: contexto!.equipeId });
  if (r.ok) return NextResponse.json({ ok: true, versao: r.versao, contrato_arquivo_nome: pdf.nome, tamanho_bytes: r.tamanhoBytes, sha256: r.sha256 });
  if (r.motivo === "bucket") return NextResponse.json({ erro: "Armazenamento indisponível no momento — tente novamente em instantes." }, { status: 502 });
  if (r.motivo === "dono_inexistente") return NAO_ENCONTRADO();
  return NextResponse.json({ erro: "Não foi possível registrar o contrato — tente novamente." }, { status: 500 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const { id: clienteId } = await params;
  const parametro = lerParametroVersao(req.nextUrl.searchParams.get("versao"));
  if (!parametro.ok) return NextResponse.json({ erro: parametro.erro }, { status: 400 });
  if (!ehUuid(clienteId)) return NAO_ENCONTRADO();

  const local = await localizarPdf(ALVO_CONTRATO, clienteId, parametro.versao);
  switch (local.status) {
    case "ok":
      return respostaDownloadPdf(local.chave, local.nome);
    case "dono_inexistente":
      return NAO_ENCONTRADO();
    case "sem_arquivo":
      return NextResponse.json({ erro: "Este cliente não tem contrato anexado." }, { status: 404 });
    case "versao_inexistente":
      return NextResponse.json({ erro: `Versão ${parametro.versao} do contrato não encontrada.` }, { status: 404 });
  }
}
