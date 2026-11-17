// Versionamento de PDF — UMA implementação pros dois documentos com
// histórico: o PDF da nota fiscal (0005) e o contrato da prefeitura
// (0009). Usado por app/api/notas/[id]/arquivo/**,
// app/api/clientes/[id]/contrato/** e app/api/integracao/clientes (o
// contrato que chega do nexaigen-educa também vira versão, nunca
// sobrescreve). Regras puras (chave, hash, Content-Disposition) em
// lib/versaoArquivo.ts; bucket SÓ via lib/armazenamentoObjetos.ts.
//
// ENVIO (registrarVersaoPdf) — nada é sobrescrito nem apagado:
//   1. grava no bucket numa chave NOVA (uuid por envio). Falha → nada no
//      banco (sem versão fantasma);
//   2. transação: trava a linha do dono (`for update`), lê max(versao),
//      insere max+1 e move o ponteiro da versão atual (colunas
//      *_chave/*_nome do dono) — tudo ou nada. O lock serializa envios
//      concorrentes; o unique (dono, versao) é a segunda barreira;
//   3. se a transação falhar DEPOIS do upload, o objeto recém-enviado é
//      removido (o ÚNICO delete do bucket no projeto); se nem isso der,
//      alertarErroSistema avisa que sobrou um órfão (só o prefixo, nunca
//      nome de arquivo nem conteúdo).
//
// DOWNLOAD (respostaDownloadPdf) — em STREAMING: o corpo do objeto vai
// direto do bucket pra resposta, nunca inteiro em memória.
//
// SQL: nomes de tabela/coluna vêm SÓ das duas constantes ALVO_* abaixo
// (código, nunca entrada do usuário); valores sempre como parâmetro.

import { randomUUID } from "node:crypto";
import { query, withTransaction } from "./db";
import * as armazenamentoObjetos from "./armazenamentoObjetos";
import { alertarErroSistema } from "./alertaErroSistema";
import { TIPO_MIME_PDF } from "./validacaoPdf";
import { calcularMetadadosArquivo, montarChaveVersao, montarContentDisposition, proximaVersao } from "./versaoArquivo";
import type { VersaoArquivoPdf } from "./tipos";

export interface AlvoVersionamento {
  tabelaVersao: "nota_fiscal_arquivo_versao" | "cliente_contrato_versao";
  colunaDono: "nota_fiscal_id" | "cliente_id";
  tabelaDono: "nota_fiscal" | "cliente_prefeitura";
  colunaChaveAtual: "arquivo_pdf_chave" | "contrato_arquivo_chave";
  colunaNomeAtual: "arquivo_pdf_nome" | "contrato_arquivo_nome";
  prefixo: (donoId: string) => string;
  categoriaAlerta: "nota_fiscal_pdf" | "contrato_pdf";
}

export const ALVO_PDF_NOTA: AlvoVersionamento = {
  tabelaVersao: "nota_fiscal_arquivo_versao",
  colunaDono: "nota_fiscal_id",
  tabelaDono: "nota_fiscal",
  colunaChaveAtual: "arquivo_pdf_chave",
  colunaNomeAtual: "arquivo_pdf_nome",
  prefixo: (notaId) => `financeiro/notas-fiscais/${notaId}`,
  categoriaAlerta: "nota_fiscal_pdf"
};

export const ALVO_CONTRATO: AlvoVersionamento = {
  tabelaVersao: "cliente_contrato_versao",
  colunaDono: "cliente_id",
  tabelaDono: "cliente_prefeitura",
  colunaChaveAtual: "contrato_arquivo_chave",
  colunaNomeAtual: "contrato_arquivo_nome",
  prefixo: (clienteId) => `financeiro/contratos-prefeitura/${clienteId}`,
  categoriaAlerta: "contrato_pdf"
};

export interface NovaVersaoPdf {
  buffer: Buffer; // já validado (lib/validacaoPdf.ts)
  nome: string;
  motivo: string | null;
  enviadoPor: string | null; // null só quando quem envia é outro sistema (integração com o Educa)
}

export type ResultadoVersao =
  | { ok: true; versao: number; tamanhoBytes: number; sha256: string }
  | { ok: false; motivo: "bucket" | "dono_inexistente" | "banco" };

class DonoRemovidoDuranteEnvio extends Error {}

export async function registrarVersaoPdf(alvo: AlvoVersionamento, donoId: string, arquivo: NovaVersaoPdf): Promise<ResultadoVersao> {
  const { tamanhoBytes, sha256 } = calcularMetadadosArquivo(arquivo.buffer);
  const idEnvio = randomUUID();
  const chave = montarChaveVersao(alvo.prefixo(donoId), idEnvio, arquivo.nome);

  if (!(await armazenamentoObjetos.uploadArquivo(chave, arquivo.buffer, TIPO_MIME_PDF))) return { ok: false, motivo: "bucket" };

  try {
    const versao = await withTransaction(async (c) => {
      const travado = await query(`select id from ${alvo.tabelaDono} where id = $1 for update`, [donoId], c);
      if (travado.length === 0) throw new DonoRemovidoDuranteEnvio();

      const [{ maior }] = await query<{ maior: number | null }>(
        `select max(versao) as maior from ${alvo.tabelaVersao} where ${alvo.colunaDono} = $1`,
        [donoId],
        c
      );
      const nova = proximaVersao(maior);
      await query(
        `insert into ${alvo.tabelaVersao} (${alvo.colunaDono}, versao, chave, nome, tamanho_bytes, sha256, enviado_por, motivo)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [donoId, nova, chave, arquivo.nome, tamanhoBytes, sha256, arquivo.enviadoPor, arquivo.motivo],
        c
      );
      await query(
        `update ${alvo.tabelaDono} set ${alvo.colunaChaveAtual} = $1, ${alvo.colunaNomeAtual} = $2 where id = $3`,
        [chave, arquivo.nome, donoId],
        c
      );
      return nova;
    });
    return { ok: true, versao, tamanhoBytes, sha256 };
  } catch (erro) {
    const removido = await armazenamentoObjetos.removerUploadNaoRegistrado(chave);
    if (!removido) {
      await alertarErroSistema(
        alvo.categoriaAlerta,
        `Gravação de versão de PDF falhou depois do upload e o objeto recém-enviado não pôde ser removido — órfão no bucket sob o prefixo ${alvo.prefixo(donoId)}/versoes/${idEnvio}/.`
      );
    }
    if (erro instanceof DonoRemovidoDuranteEnvio) return { ok: false, motivo: "dono_inexistente" };
    // Nunca o erro cru (pode ecoar valores) — só o código do pg.
    const codigo = (erro as { code?: string } | null)?.code ?? "desconhecido";
    console.error(`[versionamento-pdf] falha ao registrar versão (${alvo.tabelaVersao}) — código pg: ${codigo}.`);
    return { ok: false, motivo: "banco" };
  }
}

/** Histórico do dono, da versão mais recente pra mais antiga; `atual` = a que o ponteiro do dono aponta. */
export async function listarVersoesPdf(alvo: AlvoVersionamento, donoId: string): Promise<VersaoArquivoPdf[]> {
  return query<VersaoArquivoPdf>(
    `select
       v.versao, v.nome, v.tamanho_bytes, v.sha256, v.enviado_em, v.motivo,
       e.nome as enviado_por_nome,
       coalesce(v.chave = d.${alvo.colunaChaveAtual}, false) as atual
     from ${alvo.tabelaVersao} v
     join ${alvo.tabelaDono} d on d.id = v.${alvo.colunaDono}
     left join equipe_nexaigen e on e.id = v.enviado_por
     where v.${alvo.colunaDono} = $1
     order by v.versao desc`,
    [donoId]
  );
}

export async function donoExiste(alvo: AlvoVersionamento, donoId: string): Promise<boolean> {
  return (await query(`select 1 from ${alvo.tabelaDono} where id = $1`, [donoId])).length > 0;
}

export type LocalizacaoPdf =
  | { status: "ok"; chave: string; nome: string }
  | { status: "dono_inexistente" | "sem_arquivo" | "versao_inexistente" };

/** Onde está o PDF de `versao` (null = a versão ATUAL, pelo ponteiro do dono). */
export async function localizarPdf(alvo: AlvoVersionamento, donoId: string, versao: number | null): Promise<LocalizacaoPdf> {
  if (versao === null) {
    const [dono] = await query<{ chave: string | null; nome: string | null }>(
      `select ${alvo.colunaChaveAtual} as chave, ${alvo.colunaNomeAtual} as nome from ${alvo.tabelaDono} where id = $1`,
      [donoId]
    );
    if (!dono) return { status: "dono_inexistente" };
    if (!dono.chave) return { status: "sem_arquivo" };
    return { status: "ok", chave: dono.chave, nome: dono.nome ?? "documento.pdf" };
  }
  const [linha] = await query<{ chave: string; nome: string }>(
    `select chave, nome from ${alvo.tabelaVersao} where ${alvo.colunaDono} = $1 and versao = $2`,
    [donoId, versao]
  );
  return linha ? { status: "ok", chave: linha.chave, nome: linha.nome } : { status: "versao_inexistente" };
}

/**
 * Resposta HTTP do download, em STREAMING: o corpo do objeto passa direto
 * do bucket pro cliente. Content-Type application/pdf, nosniff, no-store e
 * nome sanitizado (lib/versaoArquivo.ts#montarContentDisposition).
 *
 * SEM Content-Length (rodada 13-A): desde o Next 16.4.5 (correção do
 * GHSA-pc58-hwjq-p385) o servidor DESCARTA content-length/content-encoding
 * de toda Response de route handler (next/dist/server/send-response.js,
 * FORBIDDEN_HEADERS) — declarar aqui seria código morto. A resposta sai
 * em transfer-encoding chunked.
 *
 * Erro ANTES de começar a transmitir (bucket fora do ar) → 502 JSON, sem
 * corpo de PDF nenhum. Objeto que sumiu do bucket → 404. Se a conexão com
 * o bucket cair NO MEIO da transmissão, o stream da resposta termina com
 * erro: o Next aborta o pipe e DESTRÓI a conexão (pipe-readable.js —
 * writer.abort → res.destroy), sem mandar o bloco final do chunked — o
 * navegador sabe que o download ficou incompleto (nunca entrega um PDF
 * truncado como se estivesse completo).
 */
export async function respostaDownloadPdf(chave: string, nome: string): Promise<Response> {
  const leitura = await armazenamentoObjetos.abrirLeituraArquivo(chave);
  if (!leitura.ok) {
    return leitura.motivo === "ausente"
      ? Response.json({ erro: "O arquivo desta versão não foi encontrado no armazenamento." }, { status: 404 })
      : Response.json({ erro: "Armazenamento indisponível no momento — tente novamente em instantes." }, { status: 502 });
  }
  const headers: Record<string, string> = {
    "content-type": TIPO_MIME_PDF,
    "content-disposition": montarContentDisposition(nome),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  return new Response(leitura.corpo, { headers });
}
