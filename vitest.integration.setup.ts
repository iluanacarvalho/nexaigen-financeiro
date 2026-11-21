// Setup da suíte de INTEGRAÇÃO (rodada 16-A3) — roda no começo de CADA
// arquivo de teste, antes dos imports dele:
//
//   1) lock_timeout de 5 s em TODA conexão do teste (PGOPTIONS, lido pelo
//      driver "pg" ao conectar): um teste que espera trava falha RÁPIDO, com o
//      erro do Postgres, em vez de estourar os 30 s do vitest sem pista;
//   2) application_name = "teste:<arquivo>" (PGAPPNAME): no Postgres dá pra
//      ver de qual arquivo é cada conexão;
//   3) teste que falha por trava ou tempo esgotado → imprime QUEM está
//      esperando e QUEM bloqueia (testes/diagnosticoTravas.ts);
//   4) no fim do arquivo: se sobrou sessão "idle in transaction" deste
//      arquivo, FALHA apontando o arquivo (transação esquecida segura trava e
//      trava o próximo teste que fizer DDL ou update na mesma tabela).
//
// Nenhum valor de variável de ambiente é impresso.

import { relative } from "node:path";
import { afterAll, beforeEach, expect } from "vitest";
import { relatorioSessoes, sessoesOciosasEmTransacao, sessoesSuspeitas } from "./testes/diagnosticoTravas";

export const LOCK_TIMEOUT_TESTES_MS = 5000;

const arquivo = relative(process.cwd(), expect.getState().testPath ?? "desconhecido");
const aplicacao = `teste:${arquivo}`.slice(0, 63); // application_name tem no máximo 63 bytes
process.env.PGOPTIONS = [process.env.PGOPTIONS, `-c lock_timeout=${LOCK_TIMEOUT_TESTES_MS}`].filter(Boolean).join(" ");
process.env.PGAPPNAME = aplicacao;
// URL do banco ANTES de qualquer arquivo trocar pro banco temporário (o diagnóstico enxerga o servidor inteiro de qualquer base).
const urlDiagnostico = process.env.DATABASE_URL;

const POR_TRAVA = /lock timeout|could not obtain lock|55P03|timed out|tempo esgotado|deadlock/i;

beforeEach(({ onTestFailed, task }) => {
  onTestFailed(async ({ task: t }) => {
    const erros = (t.result?.errors ?? []).map((e) => `${e.message ?? ""} ${(e as { code?: string }).code ?? ""}`).join(" ");
    if (!urlDiagnostico || !POR_TRAVA.test(erros)) return;
    const sessoes = await sessoesSuspeitas(urlDiagnostico).catch((e: Error) => {
      console.error(`[diagnóstico de travas] não foi possível consultar o Postgres: ${e.message}`);
      return null;
    });
    if (sessoes) console.error(`\n[diagnóstico de travas] "${task.name}" (${arquivo}) falhou por trava/tempo. Sessões agora:\n${relatorioSessoes(sessoes)}\n`);
  });
});

afterAll(async () => {
  if (!urlDiagnostico) return;
  const presas = await sessoesOciosasEmTransacao(urlDiagnostico, aplicacao);
  if (presas.length > 0) {
    throw new Error(
      `${arquivo} deixou ${presas.length} sessão(ões) "idle in transaction" (transação aberta e esquecida — segura travas e trava o próximo teste):\n` +
        presas.map((p) => `  pid ${p.pid}: ${p.consulta ?? ""}`).join("\n")
    );
  }
});
