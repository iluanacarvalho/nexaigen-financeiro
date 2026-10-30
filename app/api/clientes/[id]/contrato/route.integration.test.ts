// Contrato versionado (0009) contra Postgres REAL — os mesmos cenários do
// PDF da nota (app/api/notas/[id]/arquivo/route.integration.test.ts), pela
// mesma implementação (lib/versionamentoPdf.ts): v1 → v2 com v1 ainda
// baixável byte a byte (em streaming, arquivo maior que um pedaço do
// stream), ponteiro atual, 404/400/401, falha do bucket sem versão
// fantasma, envios concorrentes sem colisão, backfill da 0009. Bucket em
// memória (testes/bucketEmMemoria.ts), nunca o real.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/armazenamentoObjetos", async () => (await import("@/testes/bucketEmMemoria")).armazenamentoEmMemoria);
vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));

import { NextRequest } from "next/server";
import { query, withTransaction } from "@/lib/db";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { bucketEmMemoria } from "@/testes/bucketEmMemoria";
import { GET, POST } from "./route";
import { GET as GET_VERSOES } from "./versoes/route";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const sufixo = randomUUID().slice(0, 8);
let equipeId: string;
let cookie: string;
const clientes: string[] = [];

const pdfDe = (texto: string, extra = Buffer.alloc(0)) => Buffer.concat([Buffer.from(`%PDF-1.4\n${texto}\n`), extra, Buffer.from("%%EOF")]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function criarCliente(): Promise<string> {
  const [c] = await query<{ id: string }>(
    `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato) values ($1, 'PR', 1000, current_date) returning id`,
    [`Prefeitura Contrato ${sufixo} ${clientes.length}`]
  );
  clientes.push(c.id);
  return c.id;
}

function enviar(clienteId: string, conteudo: Buffer, nome: string, motivo?: string, comSessao = true) {
  const fd = new FormData();
  fd.set("arquivo", new File([new Uint8Array(conteudo)], nome, { type: "application/pdf" }));
  if (motivo) fd.set("motivo", motivo);
  return POST(new NextRequest(`http://localhost:3001/api/clientes/${clienteId}/contrato`, { method: "POST", headers: comSessao ? { cookie } : undefined, body: fd }), {
    params: Promise.resolve({ id: clienteId })
  });
}

const baixar = (clienteId: string, qs = "", comSessao = true) =>
  GET(new NextRequest(`http://localhost:3001/api/clientes/${clienteId}/contrato${qs}`, { headers: comSessao ? { cookie } : undefined }), { params: Promise.resolve({ id: clienteId }) });

const versoesNoBanco = (clienteId: string) =>
  query<{ versao: number; chave: string; nome: string; tamanho_bytes: number | null; sha256: string | null; enviado_por: string | null; motivo: string | null }>(
    `select versao, chave, nome, tamanho_bytes, sha256, enviado_por, motivo from cliente_contrato_versao where cliente_id = $1 order by versao`,
    [clienteId]
  );

beforeAll(async () => {
  const [e] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria) values ('Pessoa Contrato', $1, 'x', false) returning id, token_version`,
    [`contrato-${sufixo}@teste.nexaigen.invalid`]
  );
  equipeId = e.id;
  cookie = `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId, nome: "Pessoa Contrato", precisaTrocarSenha: false, tokenVersion: e.token_version })}`;
});

afterAll(async () => {
  await query(`delete from cliente_prefeitura where id = any($1::uuid[])`, [clientes]);
  await query(`delete from equipe_nexaigen where id = $1`, [equipeId]);
});

beforeEach(() => {
  bucketEmMemoria.falhas.proximoUpload = false;
  bucketEmMemoria.falhas.leituraIndisponivel.clear();
});

describe("contrato versionado — Postgres real", () => {
  it("v1 → v2: v1 continua baixável byte a byte (streaming, > 1 pedaço), ponteiro vai pra v2, nada é apagado", async () => {
    const clienteId = await criarCliente();
    const v1 = pdfDe("contrato original", randomBytes(20_000)); // ~5 pedaços de 4 KB no stream
    const v2 = pdfDe("aditivo 2026");

    expect((await (await enviar(clienteId, v1, "Contrato 2025.pdf")).json()).versao).toBe(1);
    expect((await (await enviar(clienteId, v2, "Contrato 2026.pdf", "Aditivo de valor")).json()).versao).toBe(2);

    const versoes = await versoesNoBanco(clienteId);
    expect(versoes.map((v) => [v.versao, v.nome, v.tamanho_bytes, v.sha256, v.enviado_por, v.motivo])).toEqual([
      [1, "Contrato 2025.pdf", v1.length, sha(v1), equipeId, null],
      [2, "Contrato 2026.pdf", v2.length, sha(v2), equipeId, "Aditivo de valor"]
    ]);
    expect(versoes[0].chave).toMatch(new RegExp(`^financeiro/contratos-prefeitura/${clienteId}/versoes/[0-9a-f-]{36}/Contrato_2025\\.pdf$`));
    expect(bucketEmMemoria.objetos.get(versoes[0].chave)?.equals(v1)).toBe(true);
    expect(bucketEmMemoria.objetos.get(versoes[1].chave)?.equals(v2)).toBe(true);

    const [cliente] = await query<{ contrato_arquivo_chave: string; contrato_arquivo_nome: string }>(
      `select contrato_arquivo_chave, contrato_arquivo_nome from cliente_prefeitura where id = $1`,
      [clienteId]
    );
    expect(cliente).toEqual({ contrato_arquivo_chave: versoes[1].chave, contrato_arquivo_nome: "Contrato 2026.pdf" });

    const atual = await baixar(clienteId);
    expect(Buffer.from(await atual.arrayBuffer()).equals(v2)).toBe(true);
    const antiga = await baixar(clienteId, "?versao=1");
    expect(antiga.headers.get("content-length")).toBe(String(v1.length));
    expect(antiga.headers.get("content-type")).toBe("application/pdf");
    expect(antiga.headers.get("x-content-type-options")).toBe("nosniff");
    expect(antiga.headers.get("cache-control")).toBe("no-store");
    expect(antiga.headers.get("content-disposition")).toContain('filename="Contrato_2025.pdf"');
    expect(Buffer.from(await antiga.arrayBuffer()).equals(v1)).toBe(true);

    const lista = await (await GET_VERSOES(new NextRequest(`http://localhost:3001/api/clientes/${clienteId}/contrato/versoes`, { headers: { cookie } }), { params: Promise.resolve({ id: clienteId }) })).json();
    expect(lista.versoes.map((v: { versao: number; atual: boolean; enviado_por_nome: string }) => [v.versao, v.atual, v.enviado_por_nome])).toEqual([
      [2, true, "Pessoa Contrato"],
      [1, false, "Pessoa Contrato"]
    ]);
    expect(bucketEmMemoria.removidos).toEqual([]);
  });

  it("versão inexistente → 404; malformada → 400; sem sessão → 401", async () => {
    const clienteId = await criarCliente();
    await enviar(clienteId, pdfDe("único"), "c.pdf");
    expect((await baixar(clienteId, "?versao=2")).status).toBe(404);
    for (const v of ["0", "abc", "-1", "1.0"]) expect((await baixar(clienteId, `?versao=${v}`)).status).toBe(400);
    expect((await baixar(clienteId, "", false)).status).toBe(401);
    expect((await enviar(clienteId, pdfDe("x"), "x.pdf", undefined, false)).status).toBe(401);
  });

  it("bucket indisponível ao baixar → 502 sem nenhum byte de PDF", async () => {
    const clienteId = await criarCliente();
    await enviar(clienteId, pdfDe("conteúdo"), "c.pdf");
    const [v] = await versoesNoBanco(clienteId);
    bucketEmMemoria.falhas.leituraIndisponivel.add(v.chave);
    const res = await baixar(clienteId);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("%PDF");
  });

  it("falha do bucket no envio → 502 e nenhuma versão nova (nem ponteiro alterado)", async () => {
    const clienteId = await criarCliente();
    await enviar(clienteId, pdfDe("v1"), "v1.pdf");
    bucketEmMemoria.falhas.proximoUpload = true;
    expect((await enviar(clienteId, pdfDe("v2"), "v2.pdf")).status).toBe(502);
    expect((await versoesNoBanco(clienteId)).map((v) => v.versao)).toEqual([1]);
  });

  it("dois envios CONCORRENTES depois da v1 → versões 2 e 3 sem colisão", async () => {
    const clienteId = await criarCliente();
    await enviar(clienteId, pdfDe("v1"), "v1.pdf");
    const [a, b] = await Promise.all([enviar(clienteId, pdfDe("A"), "a.pdf"), enviar(clienteId, pdfDe("B"), "b.pdf")]);
    expect([(await a.json()).versao, (await b.json()).versao].sort()).toEqual([2, 3]);
    const versoes = await versoesNoBanco(clienteId);
    expect(versoes.map((v) => v.versao)).toEqual([1, 2, 3]);
    expect(new Set(versoes.map((v) => v.chave)).size).toBe(3);
  });
});

describe("migration 0009 — backfill de contrato legado", () => {
  it("cliente com contrato anterior ao histórico vira v1 (e reaplicar não duplica)", async () => {
    const sql = readFileSync(join(process.cwd(), "db/migrations/0009_cliente_contrato_versao.sql"), "utf-8");
    class Desfazer extends Error {}
    await expect(
      withTransaction(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, contrato_arquivo_chave, contrato_arquivo_nome)
           values ($1, 'PR', 1000, current_date, $2, 'Contrato legado.pdf') returning id`,
          [`Prefeitura Legada ${sufixo}`, `financeiro/contratos-prefeitura/legado-${sufixo}/Contrato_legado.pdf`]
        );
        await c.query(sql);
        await c.query(sql);
        const { rows: versoes } = await c.query(`select versao, nome, sha256, tamanho_bytes, enviado_por, motivo from cliente_contrato_versao where cliente_id = $1`, [rows[0].id]);
        expect(versoes).toHaveLength(1);
        expect(versoes[0]).toMatchObject({ versao: 1, nome: "Contrato legado.pdf", sha256: null, tamanho_bytes: null, enviado_por: null });
        expect(versoes[0].motivo).toMatch(/migração 0009/);
        throw new Desfazer();
      })
    ).rejects.toBeInstanceOf(Desfazer);
  });
});
