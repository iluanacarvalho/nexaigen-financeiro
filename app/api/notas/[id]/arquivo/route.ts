// Upload/download do PDF da nota fiscal, COM HISTÓRICO DE VERSÕES
// (db/migrations/0005_nota_fiscal_arquivo_versao.sql). Este projeto NÃO
// emite NF-e — a nota já é emitida fora (prefeitura/contador); aqui só se
// guarda o arquivo. O arquivo vai pro Railway Buckets
// (lib/armazenamentoObjetos.ts); esta rota orquestra validação, bucket e
// transação.
//
// VALIDAÇÃO: lib/validacaoPdf.ts (Content-Type application/pdf, ≤10MB,
// assinatura real `%PDF-` — nunca só o que o chamador declara).
//
// POST — CADA envio é uma versão nova; nada é sobrescrito nem apagado:
//   1. valida o PDF e o motivo opcional (≤300), calcula sha256 e tamanho;
//   2. grava no bucket numa chave NOVA (uuid por envio —
//      lib/versaoArquivo.ts#montarChaveVersao), então nenhum envio grava
//      por cima do objeto de outro. Falha aqui → 502 e NADA no banco (sem
//      versão fantasma apontando pra um objeto que não existe);
//   3. numa transação: trava a linha da nota (`select ... for update`),
//      lê max(versao), insere a versão max+1 e atualiza o ponteiro
//      nota_fiscal.arquivo_pdf_chave/arquivo_pdf_nome — tudo ou nada. O
//      lock por nota serializa envios concorrentes (cada um vê o max já
//      incrementado pelo anterior); o unique (nota_fiscal_id, versao) é a
//      segunda barreira, caso algum caminho futuro esqueça o lock;
//   4. se a transação falhar DEPOIS do upload, o objeto recém-enviado é
//      removido (best-effort — é o ÚNICO delete do bucket em todo o
//      projeto, e só desfaz um envio que nunca chegou a ser registrado);
//      se até a remoção falhar, alertarErroSistema("nota_fiscal_pdf")
//      avisa que sobrou um órfão (só o prefixo da chave, nunca o nome do
//      arquivo nem o conteúdo).
//
// GET — download que passa PELO servidor (não presigned URL): permite um
// link `<a href download>` real na UI com Content-Disposition (nome
// sanitizado), Content-Type application/pdf e Cache-Control no-store
// controlados aqui. `?versao=N` baixa uma versão específica (padrão: a
// atual); N inexistente → 404, N malformado → 400.
//
// Não existe — de propósito — nenhum fluxo de remover PDF: histórico de
// documento fiscal só cresce.

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query, withTransaction } from "@/lib/db";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import * as armazenamentoObjetos from "@/lib/armazenamentoObjetos";
import { alertarErroSistema } from "@/lib/alertaErroSistema";
import { TIPO_MIME_PDF, lerPdfDoFormData } from "@/lib/validacaoPdf";
import {
  calcularMetadadosArquivo,
  lerMotivo,
  lerParametroVersao,
  montarChaveVersao,
  montarContentDisposition,
  proximaVersao
} from "@/lib/versaoArquivo";

// Id que não é uuid faria o Postgres lançar (22P02) — tratado como "não
// encontrado" antes de chegar no banco, mesmo padrão de app/api/clientes/[id].
const idValido = (id: string) => z.string().uuid().safeParse(id).success;
const NAO_ENCONTRADA = () => NextResponse.json({ erro: "Nota fiscal não encontrada." }, { status: 404 });
const ARMAZENAMENTO_INDISPONIVEL = () =>
  NextResponse.json({ erro: "Armazenamento indisponível no momento — tente novamente em instantes." }, { status: 502 });

class NotaRemovidaDuranteEnvio extends Error {}

// UPGRADE Next.js 16: `params` de route handlers dinâmicos é uma Promise.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirSessao(contexto);
  if (negado) return negado;

  const { id: notaId } = await params;
  if (!idValido(notaId)) return NAO_ENCONTRADA();

  const notas = await query<{ id: string }>(`select id from nota_fiscal where id = $1`, [notaId]);
  if (notas.length === 0) return NAO_ENCONTRADA();

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ erro: "Corpo da requisição precisa ser multipart/form-data." }, { status: 400 });

  const pdf = await lerPdfDoFormData(formData);
  if (!pdf.ok) return NextResponse.json({ erro: pdf.erro }, { status: 400 });
  const motivo = lerMotivo(formData.get("motivo"));
  if (!motivo.ok) return NextResponse.json({ erro: motivo.erro }, { status: 400 });

  const { tamanhoBytes, sha256 } = calcularMetadadosArquivo(pdf.buffer);
  const idEnvio = randomUUID();
  const chave = montarChaveVersao(notaId, idEnvio, pdf.nome);

  if (!(await armazenamentoObjetos.uploadArquivo(chave, pdf.buffer, TIPO_MIME_PDF))) return ARMAZENAMENTO_INDISPONIVEL();

  try {
    const versao = await withTransaction(async (cliente) => {
      const travada = await query(`select id from nota_fiscal where id = $1 for update`, [notaId], cliente);
      if (travada.length === 0) throw new NotaRemovidaDuranteEnvio();

      const [{ maior }] = await query<{ maior: number | null }>(
        `select max(versao) as maior from nota_fiscal_arquivo_versao where nota_fiscal_id = $1`,
        [notaId],
        cliente
      );
      const nova = proximaVersao(maior);

      await query(
        `insert into nota_fiscal_arquivo_versao (nota_fiscal_id, versao, chave, nome, tamanho_bytes, sha256, enviado_por, motivo)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [notaId, nova, chave, pdf.nome, tamanhoBytes, sha256, contexto!.equipeId, motivo.motivo],
        cliente
      );
      await query(`update nota_fiscal set arquivo_pdf_chave = $1, arquivo_pdf_nome = $2 where id = $3`, [chave, pdf.nome, notaId], cliente);
      return nova;
    });

    return NextResponse.json({ ok: true, versao, arquivo_pdf_nome: pdf.nome, tamanho_bytes: tamanhoBytes, sha256 });
  } catch (erro) {
    const removido = await armazenamentoObjetos.removerUploadNaoRegistrado(chave);
    if (!removido) {
      await alertarErroSistema(
        "nota_fiscal_pdf",
        `Gravação de versão do PDF falhou depois do upload e o objeto recém-enviado não pôde ser removido — órfão no bucket sob o prefixo financeiro/notas-fiscais/${notaId}/versoes/${idEnvio}/.`
      );
    }
    if (erro instanceof NotaRemovidaDuranteEnvio) return NAO_ENCONTRADA();

    // Nunca o erro cru (pode ecoar valores) — só o código do pg.
    const codigo = (erro as { code?: string } | null)?.code ?? "desconhecido";
    console.error(`[nota-fiscal-pdf] falha ao registrar versão do PDF — código pg: ${codigo}.`);
    return NextResponse.json({ erro: "Não foi possível registrar o PDF — tente novamente." }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirSessao(contexto);
  if (negado) return negado;

  const { id: notaId } = await params;
  const parametro = lerParametroVersao(req.nextUrl.searchParams.get("versao"));
  if (!parametro.ok) return NextResponse.json({ erro: parametro.erro }, { status: 400 });
  if (!idValido(notaId)) return NAO_ENCONTRADA();

  let alvo: { chave: string; nome: string } | null;
  if (parametro.versao === null) {
    const notas = await query<{ arquivo_pdf_chave: string | null; arquivo_pdf_nome: string | null }>(
      `select arquivo_pdf_chave, arquivo_pdf_nome from nota_fiscal where id = $1`,
      [notaId]
    );
    if (notas.length === 0) return NAO_ENCONTRADA();
    const { arquivo_pdf_chave: chave, arquivo_pdf_nome: nome } = notas[0];
    if (!chave) return NextResponse.json({ erro: "Esta nota fiscal não tem PDF anexado." }, { status: 404 });
    alvo = { chave, nome: nome ?? "nota-fiscal.pdf" };
  } else {
    const versoes = await query<{ chave: string; nome: string }>(
      `select chave, nome from nota_fiscal_arquivo_versao where nota_fiscal_id = $1 and versao = $2`,
      [notaId, parametro.versao]
    );
    alvo = versoes[0] ?? null;
    if (!alvo) return NextResponse.json({ erro: `Versão ${parametro.versao} não encontrada para esta nota fiscal.` }, { status: 404 });
  }

  const bytes = await armazenamentoObjetos.baixarArquivo(alvo.chave);
  if (!bytes) return ARMAZENAMENTO_INDISPONIVEL();

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": TIPO_MIME_PDF,
      "content-disposition": montarContentDisposition(alvo.nome),
      "content-length": String(bytes.length),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
