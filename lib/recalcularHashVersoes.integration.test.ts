// lib/recalcularHashVersoes.ts contra Postgres REAL + bucket em memória
// (testes/bucketEmMemoria.ts): versões de nota e de contrato sem hash →
// recalculadas a partir do objeto (em streaming); objeto ausente e bucket
// indisponível contados à parte sem impedir as outras; idempotente.
// Roda numa transação desfeita no fim (executor) — nada fica no banco.

import { describe, expect, it, vi } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";

vi.mock("@/lib/armazenamentoObjetos", async () => (await import("@/testes/bucketEmMemoria")).armazenamentoEmMemoria);
vi.mock("./armazenamentoObjetos", async () => (await import("@/testes/bucketEmMemoria")).armazenamentoEmMemoria);

import { withTransaction } from "./db";
import { bucketEmMemoria } from "@/testes/bucketEmMemoria";
import { recalcularHashesVersoes } from "./recalcularHashVersoes";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

class Desfazer extends Error {}

/** Transação SEMPRE desfeita no fim; uma asserção que falha dentro dela aparece como ela mesma. */
async function emTransacaoDesfeita(fn: Parameters<typeof withTransaction>[0]): Promise<void> {
  try {
    await withTransaction(async (c) => {
      await fn(c);
      throw new Desfazer();
    });
  } catch (erro) {
    if (!(erro instanceof Desfazer)) throw erro;
  }
}

describe("recalcularHashesVersoes — Postgres real", () => {
  it("preenche nota e contrato a partir do objeto; ausente e erro não impedem as demais; segunda rodada não reprocessa", async () => {
    const s = randomUUID().slice(0, 8);
    const conteudoNota = Buffer.concat([Buffer.from("%PDF-1.4 nota "), randomBytes(9000)]);
    const conteudoContrato = Buffer.from("%PDF-1.4 contrato");
    const chaves = {
      nota: `teste-recalc/${s}/nota.pdf`,
      contrato: `teste-recalc/${s}/contrato.pdf`,
      ausente: `teste-recalc/${s}/sumiu.pdf`,
      indisponivel: `teste-recalc/${s}/fora-do-ar.pdf`,
      jaPreenchida: `teste-recalc/${s}/pronta.pdf`
    };
    bucketEmMemoria.objetos.set(chaves.nota, conteudoNota);
    bucketEmMemoria.objetos.set(chaves.contrato, conteudoContrato);
    bucketEmMemoria.objetos.set(chaves.indisponivel, Buffer.from("%PDF-x"));
    bucketEmMemoria.falhas.leituraIndisponivel.add(chaves.indisponivel);

    await emTransacaoDesfeita(async (c) => {
        const { rows: [cliente] } = await c.query<{ id: string }>(
          `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato) values ($1, 'PR', 1, current_date) returning id`,
          [`Prefeitura Recalc ${s}`]
        );
        const { rows: [nota] } = await c.query<{ id: string }>(`insert into nota_fiscal (cliente_id, competencia, valor) values ($1, '2026-01-01', 1) returning id`, [cliente.id]);
        const inserirVersaoNota = (versao: number, chave: string, sha: string | null = null, tamanho: number | null = null) =>
          c.query(`insert into nota_fiscal_arquivo_versao (nota_fiscal_id, versao, chave, nome, sha256, tamanho_bytes) values ($1, $2, $3, 'x.pdf', $4, $5)`, [nota.id, versao, chave, sha, tamanho]);
        await inserirVersaoNota(1, chaves.nota);
        await inserirVersaoNota(2, chaves.ausente);
        await inserirVersaoNota(3, chaves.indisponivel);
        await inserirVersaoNota(4, chaves.jaPreenchida, "f".repeat(64), 123);
        await c.query(`insert into cliente_contrato_versao (cliente_id, versao, chave, nome) values ($1, 1, $2, 'c.pdf')`, [cliente.id, chaves.contrato]);

        const r1 = await recalcularHashesVersoes(c);
        const nossas = r1.falhas.filter((f) => f.chave.startsWith(`teste-recalc/${s}/`));
        const porChave = Object.fromEntries(nossas.map((f) => [f.chave, f.motivo]));
        expect(porChave).toEqual({ [chaves.ausente]: "objeto_ausente", [chaves.indisponivel]: "erro" });
        expect(r1.ok).toBeGreaterThanOrEqual(2);

        const { rows: versoesNota } = await c.query(`select versao, sha256, tamanho_bytes from nota_fiscal_arquivo_versao where nota_fiscal_id = $1 order by versao`, [nota.id]);
        expect(versoesNota).toEqual([
          { versao: 1, sha256: createHash("sha256").update(conteudoNota).digest("hex"), tamanho_bytes: conteudoNota.length },
          { versao: 2, sha256: null, tamanho_bytes: null },
          { versao: 3, sha256: null, tamanho_bytes: null },
          { versao: 4, sha256: "f".repeat(64), tamanho_bytes: 123 } // já tinha: nunca reescrito
        ]);
        const { rows: [contrato] } = await c.query(`select sha256, tamanho_bytes from cliente_contrato_versao where cliente_id = $1`, [cliente.id]);
        expect(contrato).toEqual({ sha256: createHash("sha256").update(conteudoContrato).digest("hex"), tamanho_bytes: conteudoContrato.length });

        // Idempotente: o que já foi preenchido não volta pra fila.
        const r2 = await recalcularHashesVersoes(c);
        expect(r2.falhas.filter((f) => f.chave.startsWith(`teste-recalc/${s}/`)).map((f) => f.chave).sort()).toEqual([chaves.ausente, chaves.indisponivel].sort());
        expect(r2.total).toBe(r1.total - r1.ok);
    });
  });
});
