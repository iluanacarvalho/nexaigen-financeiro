// Histórico de versões do PDF da nota fiscal contra Postgres REAL: rotas
// reais (upload, download, listagem), migration 0005 real, lock por nota
// real. Só o armazenamento de objetos é substituído — por um bucket EM
// MEMÓRIA (testes/bucketEmMemoria.ts), nunca o Railway de verdade; o módulo real
// já é testado isoladamente em lib/armazenamentoObjetos.test.ts.
// Nada aqui chama Resend (alertarErroSistema mockado).
//   docker compose up -d && npm run migrate && npm run test:integration

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/armazenamentoObjetos", async () => (await import("@/testes/bucketEmMemoria")).armazenamentoEmMemoria);
vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));

import { NextRequest } from "next/server";
import { bucketEmMemoria } from "@/testes/bucketEmMemoria";
import { query, withTransaction } from "@/lib/db";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { GET, POST } from "./route";
import { GET as GET_VERSOES } from "./versoes/route";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const sufixo = randomUUID().slice(0, 8);
let equipeId: string;
let clienteId: string;
let cookie: string;

const pdfDe = (texto: string) => Buffer.from(`%PDF-1.4\n${texto}\n%%EOF`);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function criarNota(): Promise<string> {
  const r = await query<{ id: string }>(`insert into nota_fiscal (cliente_id, competencia, valor) values ($1, '2026-10-01', 1000) returning id`, [clienteId]);
  return r[0].id;
}

function enviar(notaId: string, conteudo: Buffer, nome: string, motivo?: string, comSessao = true) {
  const fd = new FormData();
  fd.set("arquivo", new File([new Uint8Array(conteudo)], nome, { type: "application/pdf" }));
  if (motivo) fd.set("motivo", motivo);
  return POST(
    new NextRequest(`http://localhost:3001/api/notas/${notaId}/arquivo`, { method: "POST", headers: comSessao ? { cookie } : undefined, body: fd }),
    { params: Promise.resolve({ id: notaId }) }
  );
}

function baixar(notaId: string, qs = "", comSessao = true) {
  return GET(new NextRequest(`http://localhost:3001/api/notas/${notaId}/arquivo${qs}`, { headers: comSessao ? { cookie } : undefined }), {
    params: Promise.resolve({ id: notaId })
  });
}

async function listar(notaId: string, comSessao = true) {
  return GET_VERSOES(new NextRequest(`http://localhost:3001/api/notas/${notaId}/arquivo/versoes`, { headers: comSessao ? { cookie } : undefined }), {
    params: Promise.resolve({ id: notaId })
  });
}

async function versoesNoBanco(notaId: string) {
  return query<{ versao: number; chave: string; nome: string; tamanho_bytes: number | null; sha256: string | null; enviado_por: string | null; motivo: string | null }>(
    `select versao, chave, nome, tamanho_bytes, sha256, enviado_por, motivo from nota_fiscal_arquivo_versao where nota_fiscal_id = $1 order by versao`,
    [notaId]
  );
}

beforeAll(async () => {
  const e = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria)
     values ('Pessoa Teste Versões', $1, 'hash-irrelevante', false) returning id, token_version`,
    [`versoes-${sufixo}@teste.nexaigen.invalid`]
  );
  equipeId = e[0].id;
  cookie = `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId, nome: "Pessoa Teste Versões", precisaTrocarSenha: false, tokenVersion: e[0].token_version })}`;
  const c = await query<{ id: string }>(
    `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato) values ($1, 'PR', 1000, current_date) returning id`,
    [`Prefeitura Teste Versões ${sufixo}`]
  );
  clienteId = c[0].id;
});

afterAll(async () => {
  // Cliente primeiro: cascata apaga notas e versões (que referenciam a equipe), depois a equipe.
  await query(`delete from cliente_prefeitura where id = $1`, [clienteId]);
  await query(`delete from equipe_nexaigen where id = $1`, [equipeId]);
});

beforeEach(() => {
  bucketEmMemoria.falhas.proximoUpload = false;
});

describe("versões do PDF — fluxo completo em Postgres real", () => {
  it("v1 → v2: v1 continua baixável com o mesmo conteúdo, ponteiro atual vai pra v2, nada é apagado", async () => {
    const notaId = await criarNota();
    const conteudoV1 = pdfDe("versão um");
    const conteudoV2 = pdfDe("versão dois, corrigida");

    const r1 = await enviar(notaId, conteudoV1, "NF 100.pdf");
    expect(r1.status).toBe(200);
    expect((await r1.json()).versao).toBe(1);

    const r2 = await enviar(notaId, conteudoV2, "NF 100 corrigida.pdf", "Valor corrigido pela prefeitura");
    expect(r2.status).toBe(200);
    expect((await r2.json()).versao).toBe(2);

    const versoes = await versoesNoBanco(notaId);
    expect(versoes.map((v) => [v.versao, v.nome, v.tamanho_bytes, v.sha256, v.enviado_por, v.motivo])).toEqual([
      [1, "NF 100.pdf", conteudoV1.length, sha(conteudoV1), equipeId, null],
      [2, "NF 100 corrigida.pdf", conteudoV2.length, sha(conteudoV2), equipeId, "Valor corrigido pela prefeitura"]
    ]);
    expect(versoes[0].chave).not.toBe(versoes[1].chave);
    // Os DOIS objetos continuam no bucket.
    expect(bucketEmMemoria.objetos.get(versoes[0].chave)?.equals(conteudoV1)).toBe(true);
    expect(bucketEmMemoria.objetos.get(versoes[1].chave)?.equals(conteudoV2)).toBe(true);

    const [nota] = await query<{ arquivo_pdf_chave: string; arquivo_pdf_nome: string }>(
      `select arquivo_pdf_chave, arquivo_pdf_nome from nota_fiscal where id = $1`,
      [notaId]
    );
    expect(nota).toEqual({ arquivo_pdf_chave: versoes[1].chave, arquivo_pdf_nome: "NF 100 corrigida.pdf" });

    // Download: padrão = atual (v2); ?versao=1 e ?versao=2 trazem o conteúdo exato de cada uma.
    const atual = await baixar(notaId);
    expect(Buffer.from(await atual.arrayBuffer()).equals(conteudoV2)).toBe(true);
    const v1 = await baixar(notaId, "?versao=1");
    expect(v1.status).toBe(200);
    expect(v1.headers.get("content-type")).toBe("application/pdf");
    expect(v1.headers.get("cache-control")).toBe("no-store");
    expect(v1.headers.get("content-disposition")).toContain('filename="NF_100.pdf"');
    expect(Buffer.from(await v1.arrayBuffer()).equals(conteudoV1)).toBe(true);
    const v2 = await baixar(notaId, "?versao=2");
    expect(Buffer.from(await v2.arrayBuffer()).equals(conteudoV2)).toBe(true);

    // Listagem: mais recente primeiro, só a v2 marcada como atual, nome de quem enviou.
    const lista = await (await listar(notaId)).json();
    expect(lista.versoes.map((v: { versao: number; atual: boolean; enviado_por_nome: string }) => [v.versao, v.atual, v.enviado_por_nome])).toEqual([
      [2, true, "Pessoa Teste Versões"],
      [1, false, "Pessoa Teste Versões"]
    ]);
    expect(lista.versoes[1]).toMatchObject({ nome: "NF 100.pdf", tamanho_bytes: conteudoV1.length, sha256: sha(conteudoV1), motivo: null });
    expect(JSON.stringify(lista)).not.toContain("@teste.nexaigen.invalid");

    // GET /api/notas expõe o número da versão atual pra UI.
    const { GET: GET_NOTAS } = await import("@/app/api/notas/route");
    const notas = await (await GET_NOTAS(new NextRequest("http://localhost:3001/api/notas", { headers: { cookie } }))).json();
    expect(notas.notas.find((n: { id: string }) => n.id === notaId).arquivo_pdf_versao_atual).toBe(2);

    expect(bucketEmMemoria.removidos).toEqual([]);
  });

  it("versão inexistente → 404; versão malformada → 400", async () => {
    const notaId = await criarNota();
    await enviar(notaId, pdfDe("única"), "a.pdf");

    expect((await baixar(notaId, "?versao=2")).status).toBe(404);
    for (const invalida of ["0", "abc", "-1", "1.0"]) {
      expect((await baixar(notaId, `?versao=${invalida}`)).status).toBe(400);
    }
  });

  it("sem sessão → 401 em upload, download e listagem, e nada é gravado", async () => {
    const notaId = await criarNota();
    expect((await enviar(notaId, pdfDe("x"), "x.pdf", undefined, false)).status).toBe(401);
    expect((await baixar(notaId, "", false)).status).toBe(401);
    expect((await baixar(notaId, "?versao=1", false)).status).toBe(401);
    expect((await listar(notaId, false)).status).toBe(401);
    expect(await versoesNoBanco(notaId)).toEqual([]);
  });

  it("falha simulada do bucket → 502 e nenhuma versão criada (nem ponteiro alterado)", async () => {
    const notaId = await criarNota();
    await enviar(notaId, pdfDe("v1"), "v1.pdf");
    const antes = await query(`select arquivo_pdf_chave from nota_fiscal where id = $1`, [notaId]);

    bucketEmMemoria.falhas.proximoUpload = true;
    const res = await enviar(notaId, pdfDe("v2 que não chega"), "v2.pdf");

    expect(res.status).toBe(502);
    expect((await versoesNoBanco(notaId)).map((v) => v.versao)).toEqual([1]);
    expect(await query(`select arquivo_pdf_chave from nota_fiscal where id = $1`, [notaId])).toEqual(antes);
  });

  it("dois envios CONCORRENTES depois da v1 → versões 2 e 3, sem colisão nem erro", async () => {
    const notaId = await criarNota();
    await enviar(notaId, pdfDe("v1"), "v1.pdf");

    const [a, b] = await Promise.all([enviar(notaId, pdfDe("concorrente A"), "a.pdf"), enviar(notaId, pdfDe("concorrente B"), "b.pdf")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const numeros = [(await a.json()).versao, (await b.json()).versao].sort();
    expect(numeros).toEqual([2, 3]);

    const versoes = await versoesNoBanco(notaId);
    expect(versoes.map((v) => v.versao)).toEqual([1, 2, 3]);
    expect(new Set(versoes.map((v) => v.chave)).size).toBe(3);
    // Ponteiro aponta pra última versão gravada.
    const [nota] = await query<{ arquivo_pdf_chave: string }>(`select arquivo_pdf_chave from nota_fiscal where id = $1`, [notaId]);
    expect(nota.arquivo_pdf_chave).toBe(versoes[2].chave);
  });
});

describe("migration 0005 — backfill de nota legada", () => {
  it("nota com PDF anterior ao histórico vira v1 ao aplicar a migration (e reaplicar não duplica)", async () => {
    const sql = readFileSync(join(process.cwd(), "db/migrations/0005_nota_fiscal_arquivo_versao.sql"), "utf-8");
    class Desfazer extends Error {}

    await expect(
      withTransaction(async (c) => {
        // Estado "pré-0005": nota com arquivo_pdf_chave/nome preenchidos e nenhuma linha de versão.
        const { rows } = await c.query<{ id: string }>(
          `insert into nota_fiscal (cliente_id, competencia, valor, arquivo_pdf_chave, arquivo_pdf_nome)
           values ($1, '2026-05-01', 700, $2, 'NF legada.pdf') returning id`,
          [clienteId, `financeiro/notas-fiscais/legada-${sufixo}/NF_legada.pdf`]
        );
        const notaLegada = rows[0].id;
        expect((await c.query(`select 1 from nota_fiscal_arquivo_versao where nota_fiscal_id = $1`, [notaLegada])).rowCount).toBe(0);

        await c.query(sql);
        await c.query(sql); // idempotente

        const { rows: versoes } = await c.query(
          `select versao, chave, nome, tamanho_bytes, sha256, enviado_por, motivo from nota_fiscal_arquivo_versao where nota_fiscal_id = $1`,
          [notaLegada]
        );
        expect(versoes).toHaveLength(1);
        expect(versoes[0]).toMatchObject({
          versao: 1,
          chave: `financeiro/notas-fiscais/legada-${sufixo}/NF_legada.pdf`,
          nome: "NF legada.pdf",
          tamanho_bytes: null,
          sha256: null,
          enviado_por: null
        });
        expect(versoes[0].motivo).toMatch(/migração 0005/);

        // A versão vinda do backfill é reconhecida como a atual.
        const { rows: atual } = await c.query(
          `select v.versao from nota_fiscal_arquivo_versao v join nota_fiscal nf on nf.arquivo_pdf_chave = v.chave where nf.id = $1`,
          [notaLegada]
        );
        expect(atual).toEqual([{ versao: 1 }]);
        throw new Desfazer(); // rollback — não deixa a nota legada de teste no banco
      })
    ).rejects.toBeInstanceOf(Desfazer);
  });
});
