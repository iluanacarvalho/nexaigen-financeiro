// Preenche sha256/tamanho_bytes das versões de PDF que estão sem eles —
// as que vieram do backfill da 0005 (nota fiscal) e da 0009 (contrato),
// cujo PDF já estava no bucket e não foi relido pela migration. Usado por
// scripts/recalcular-hash-versoes-pdf.ts (npm run recalcular-hash-versoes).
//
// - Lê o objeto em STREAMING (lib/armazenamentoObjetos.ts#abrirLeituraArquivo
//   — a única porta pro bucket), calculando o hash pedaço por pedaço; nunca
//   o arquivo inteiro em memória.
// - Idempotente: só toca versão com sha256 OU tamanho nulos, e o UPDATE
//   repete essa condição (rodar duas vezes, ou em paralelo, não reescreve
//   nada já preenchido).
// - Uma versão que falha não impede as demais; relatório final com as
//   contagens (ok, objeto ausente no bucket, erro).

import { createHash } from "node:crypto";
import { query, type Executor } from "./db";
import * as armazenamentoObjetos from "./armazenamentoObjetos";

const TABELAS = ["nota_fiscal_arquivo_versao", "cliente_contrato_versao"] as const;

export interface RelatorioRecalculo {
  total: number;
  ok: number;
  objetoAusente: number;
  erro: number;
  /** Só pra diagnóstico — tabela + versão + chave (nunca conteúdo). */
  falhas: { tabela: string; id: string; chave: string; motivo: "objeto_ausente" | "erro" }[];
}

async function hashDoStream(corpo: ReadableStream<Uint8Array>): Promise<{ sha256: string; tamanhoBytes: number }> {
  const hash = createHash("sha256");
  let tamanhoBytes = 0;
  const leitor = corpo.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    hash.update(value);
    tamanhoBytes += value.byteLength;
  }
  return { sha256: hash.digest("hex"), tamanhoBytes };
}

export async function recalcularHashesVersoes(executor?: Executor): Promise<RelatorioRecalculo> {
  const relatorio: RelatorioRecalculo = { total: 0, ok: 0, objetoAusente: 0, erro: 0, falhas: [] };

  for (const tabela of TABELAS) {
    const pendentes = await query<{ id: string; chave: string }>(
      `select id, chave from ${tabela} where sha256 is null or tamanho_bytes is null order by enviado_em, id`,
      [],
      executor
    );
    for (const versao of pendentes) {
      relatorio.total += 1;
      try {
        const leitura = await armazenamentoObjetos.abrirLeituraArquivo(versao.chave);
        if (!leitura.ok) {
          const motivo = leitura.motivo === "ausente" ? "objeto_ausente" : "erro";
          if (motivo === "objeto_ausente") relatorio.objetoAusente += 1;
          else relatorio.erro += 1;
          relatorio.falhas.push({ tabela, id: versao.id, chave: versao.chave, motivo });
          continue;
        }
        const { sha256, tamanhoBytes } = await hashDoStream(leitura.corpo);
        await query(
          `update ${tabela} set sha256 = $1, tamanho_bytes = $2 where id = $3 and (sha256 is null or tamanho_bytes is null)`,
          [sha256, tamanhoBytes, versao.id],
          executor
        );
        relatorio.ok += 1;
      } catch {
        // Stream que cai no meio, erro de banco numa linha: conta e segue pras outras.
        relatorio.erro += 1;
        relatorio.falhas.push({ tabela, id: versao.id, chave: versao.chave, motivo: "erro" });
      }
    }
  }
  return relatorio;
}
