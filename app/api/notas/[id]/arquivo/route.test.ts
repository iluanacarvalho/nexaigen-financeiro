// Testes unitários de POST/GET /api/notas/[id]/arquivo — PDF da nota
// fiscal com histórico de versões. Mocka @/lib/db (query + withTransaction),
// @/lib/armazenamentoObjetos inteiro e @/lib/alertaErroSistema — nunca
// Postgres, bucket ou Resend reais. O comportamento contra Postgres real
// (lock por nota, concorrência, backfill) está em route.integration.test.ts.
// Cookie de sessão REAL (gerarAccessToken), mesmo padrão de lib/auth.test.ts.

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "chave-de-teste-jwt-apenas-unitario";

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, withTransactionMock, uploadMock, baixarMock, removerMock, alertarMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  withTransactionMock: vi.fn(),
  uploadMock: vi.fn(),
  baixarMock: vi.fn(),
  removerMock: vi.fn(),
  alertarMock: vi.fn()
}));
vi.mock("@/lib/db", () => ({ query: queryMock, withTransaction: withTransactionMock }));
vi.mock("@/lib/armazenamentoObjetos", () => ({
  uploadArquivo: uploadMock,
  baixarArquivo: baixarMock,
  removerUploadNaoRegistrado: removerMock,
  gerarUrlDownload: vi.fn()
}));
vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: alertarMock }));

import { NextRequest } from "next/server";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { GET, POST } from "./route";

const EQUIPE_ID = "7a1b2c3d-0000-4000-8000-000000000001";
const NOTA_ID = "7a1b2c3d-0000-4000-8000-0000000000aa";
const TOKEN_VERSION = 1;
const CONTEUDO_PDF = Buffer.from("%PDF-1.4 conteúdo de teste");
const PREFIXO_VERSOES = `financeiro/notas-fiscais/${NOTA_ID}/versoes/`;

async function cookieSessao(): Promise<string> {
  const token = await gerarAccessToken({ equipeId: EQUIPE_ID, nome: "Teste", precisaTrocarSenha: false, tokenVersion: TOKEN_VERSION });
  return `${NOME_COOKIE_ACCESS}=${token}`;
}

function pdf(nome = "nota.pdf", conteudo: Buffer = CONTEUDO_PDF): File {
  return new File([new Uint8Array(conteudo)], nome, { type: "application/pdf" });
}

function upload(campos: { arquivo?: File; motivo?: string } | null, cookie?: string, id = NOTA_ID) {
  let body: FormData | string | undefined;
  if (campos) {
    const fd = new FormData();
    if (campos.arquivo) fd.set("arquivo", campos.arquivo);
    if (campos.motivo !== undefined) fd.set("motivo", campos.motivo);
    body = fd;
  } else body = "{}";
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (!campos) headers["content-type"] = "application/json";
  return POST(new NextRequest(`http://localhost:3001/api/notas/${id}/arquivo`, { method: "POST", headers, body }), {
    params: Promise.resolve({ id })
  });
}

function download(cookie?: string, sufixo = "", id = NOTA_ID) {
  return GET(new NextRequest(`http://localhost:3001/api/notas/${id}/arquivo${sufixo}`, { headers: cookie ? { cookie } : undefined }), {
    params: Promise.resolve({ id })
  });
}

/** Dispacha a resposta de `query` pelo texto da SQL — mesmo padrão dos outros testes de rota. */
function configurarBanco(opts: {
  notaExiste?: boolean;
  maiorVersao?: number | null;
  pdfAtual?: { chave: string; nome: string } | null;
  versao?: { chave: string; nome: string } | null;
  falharInsert?: boolean;
} = {}) {
  const { notaExiste = true, maiorVersao = null, pdfAtual = null, versao = null, falharInsert = false } = opts;
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("from equipe_nexaigen")) return [{ token_version: TOKEN_VERSION, ativo: true }];
    if (sql.includes("select id from nota_fiscal")) return notaExiste ? [{ id: NOTA_ID }] : [];
    if (sql.includes("select max(versao)")) return [{ maior: maiorVersao }];
    if (sql.includes("insert into nota_fiscal_arquivo_versao")) {
      if (falharInsert) throw Object.assign(new Error("conexão caiu"), { code: "57P01" });
      return [];
    }
    if (sql.includes("update nota_fiscal set arquivo_pdf_chave")) return [];
    if (sql.includes("select arquivo_pdf_chave, arquivo_pdf_nome")) {
      return notaExiste ? [{ arquivo_pdf_chave: pdfAtual?.chave ?? null, arquivo_pdf_nome: pdfAtual?.nome ?? null }] : [];
    }
    if (sql.includes("from nota_fiscal_arquivo_versao where nota_fiscal_id = $1 and versao = $2")) return versao ? [versao] : [];
    throw new Error(`queryMock: SQL não esperada: ${sql}`);
  });
  withTransactionMock.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => fn({}));
}

const chamadaSql = (trecho: string) => queryMock.mock.calls.find((c: unknown[]) => (c[0] as string).includes(trecho));

beforeEach(() => {
  for (const m of [queryMock, withTransactionMock, uploadMock, baixarMock, removerMock, alertarMock]) m.mockReset();
});

describe("POST /api/notas/[id]/arquivo — nova versão", () => {
  it("sem sessão — 401, nunca toca banco nem bucket", async () => {
    const res = await upload({ arquivo: pdf() });
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("primeiro envio — v1: chave única por versão, sha256/tamanho/autor gravados, ponteiro atualizado na mesma transação", async () => {
    configurarBanco({ maiorVersao: null });
    uploadMock.mockResolvedValue(true);

    const res = await upload({ arquivo: pdf("NF 123.pdf") }, await cookieSessao());
    const corpo = await res.json();
    const sha256 = createHash("sha256").update(CONTEUDO_PDF).digest("hex");

    expect(res.status).toBe(200);
    expect(corpo).toEqual({ ok: true, versao: 1, arquivo_pdf_nome: "NF 123.pdf", tamanho_bytes: CONTEUDO_PDF.length, sha256 });

    const [chave, buffer, tipo] = uploadMock.mock.calls[0];
    expect(chave).toMatch(new RegExp(`^${PREFIXO_VERSOES}[0-9a-f-]{36}/NF_123\\.pdf$`));
    expect((buffer as Buffer).equals(CONTEUDO_PDF)).toBe(true);
    expect(tipo).toBe("application/pdf");

    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(chamadaSql("for update")).toBeDefined();
    expect(chamadaSql("insert into nota_fiscal_arquivo_versao")![1]).toEqual([NOTA_ID, 1, chave, "NF 123.pdf", CONTEUDO_PDF.length, sha256, EQUIPE_ID, null]);
    expect(chamadaSql("update nota_fiscal set arquivo_pdf_chave")![1]).toEqual([chave, "NF 123.pdf", NOTA_ID]);
    expect(removerMock).not.toHaveBeenCalled();
  });

  it("já existem 2 versões — grava v3 com o motivo aparado", async () => {
    configurarBanco({ maiorVersao: 2 });
    uploadMock.mockResolvedValue(true);

    const res = await upload({ arquivo: pdf(), motivo: "  NF reemitida com valor corrigido " }, await cookieSessao());

    expect((await res.json()).versao).toBe(3);
    const params = chamadaSql("insert into nota_fiscal_arquivo_versao")![1] as unknown[];
    expect(params[1]).toBe(3);
    expect(params[7]).toBe("NF reemitida com valor corrigido");
  });

  it("duas chamadas seguidas nunca reutilizam a mesma chave de objeto", async () => {
    configurarBanco({ maiorVersao: 1 });
    uploadMock.mockResolvedValue(true);
    const cookie = await cookieSessao();

    await upload({ arquivo: pdf("x.pdf") }, cookie);
    await upload({ arquivo: pdf("x.pdf") }, cookie);

    expect(uploadMock.mock.calls[0][0]).not.toBe(uploadMock.mock.calls[1][0]);
  });

  it("falha no bucket — 502 e NADA no banco (sem versão fantasma)", async () => {
    configurarBanco();
    uploadMock.mockResolvedValue(false);

    const res = await upload({ arquivo: pdf() }, await cookieSessao());

    expect(res.status).toBe(502);
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(chamadaSql("insert into nota_fiscal_arquivo_versao")).toBeUndefined();
  });

  it("falha no banco DEPOIS do upload — remove o objeto recém-enviado, 500, sem alerta (limpeza deu certo)", async () => {
    configurarBanco({ falharInsert: true });
    uploadMock.mockResolvedValue(true);
    removerMock.mockResolvedValue(true);

    const res = await upload({ arquivo: pdf() }, await cookieSessao());

    expect(res.status).toBe(500);
    expect(removerMock).toHaveBeenCalledWith(uploadMock.mock.calls[0][0]);
    expect(alertarMock).not.toHaveBeenCalled();
  });

  it("falha no banco E falha na limpeza — alerta nota_fiscal_pdf com o prefixo do órfão, sem nome de arquivo", async () => {
    configurarBanco({ falharInsert: true });
    uploadMock.mockResolvedValue(true);
    removerMock.mockResolvedValue(false);

    const res = await upload({ arquivo: pdf("Nota de Fulano.pdf") }, await cookieSessao());

    expect(res.status).toBe(500);
    expect(alertarMock).toHaveBeenCalledTimes(1);
    const [categoria, mensagem] = alertarMock.mock.calls[0];
    expect(categoria).toBe("nota_fiscal_pdf");
    expect(mensagem).toContain(PREFIXO_VERSOES);
    expect(mensagem).not.toContain("Fulano");
  });

  it.each([
    ["Content-Type diferente de PDF", { arquivo: new File(["%PDF-1.4"], "a.exe", { type: "application/x-msdownload" }) }],
    ["assinatura não é %PDF-", { arquivo: new File(["não é pdf"], "fingido.pdf", { type: "application/pdf" }) }],
    ["campo arquivo ausente", {}],
    ["motivo com 301 caracteres", { arquivo: pdf(), motivo: "a".repeat(301) }]
  ])("%s — 400, nunca envia ao bucket", async (_d, campos) => {
    configurarBanco();
    const res = await upload(campos, await cookieSessao());
    expect(res.status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("arquivo maior que 10MB — 400", async () => {
    configurarBanco();
    const grande = Buffer.alloc(10 * 1024 * 1024 + 1);
    grande.write("%PDF-");
    const res = await upload({ arquivo: pdf("g.pdf", grande) }, await cookieSessao());
    expect(res.status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("corpo não multipart — 400", async () => {
    configurarBanco();
    expect((await upload(null, await cookieSessao())).status).toBe(400);
  });

  it("nota inexistente — 404; id que não é uuid — 404 sem chegar ao banco", async () => {
    configurarBanco({ notaExiste: false });
    const cookie = await cookieSessao();
    expect((await upload({ arquivo: pdf() }, cookie)).status).toBe(404);
    queryMock.mockClear();
    expect((await upload({ arquivo: pdf() }, cookie, "nota-1")).status).toBe(404);
    expect(chamadaSql("from nota_fiscal where")).toBeUndefined();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/notas/[id]/arquivo — download", () => {
  const ATUAL = { chave: `${PREFIXO_VERSOES}u2/NF.pdf`, nome: "NF Jaguapitã.pdf" };

  it("sem sessão — 401", async () => {
    const res = await download();
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("sem ?versao — baixa a versão ATUAL pelos próprios bytes, com headers seguros", async () => {
    configurarBanco({ pdfAtual: ATUAL });
    baixarMock.mockResolvedValue(CONTEUDO_PDF);

    const res = await download(await cookieSessao());

    expect(res.status).toBe(200);
    expect(baixarMock).toHaveBeenCalledWith(ATUAL.chave);
    expect(Buffer.from(await res.arrayBuffer()).equals(CONTEUDO_PDF)).toBe(true);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-length")).toBe(String(CONTEUDO_PDF.length));
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="NF_Jaguapit_.pdf"; filename*=UTF-8''NF%20Jaguapit%C3%A3.pdf`);
  });

  it("?versao=1 — baixa aquela versão específica", async () => {
    configurarBanco({ versao: { chave: `${PREFIXO_VERSOES}u1/antiga.pdf`, nome: "antiga.pdf" } });
    baixarMock.mockResolvedValue(CONTEUDO_PDF);

    const res = await download(await cookieSessao(), "?versao=1");

    expect(res.status).toBe(200);
    expect(chamadaSql("and versao = $2")![1]).toEqual([NOTA_ID, 1]);
    expect(baixarMock).toHaveBeenCalledWith(`${PREFIXO_VERSOES}u1/antiga.pdf`);
  });

  it("?versao inexistente — 404, nunca toca o bucket", async () => {
    configurarBanco({ versao: null });
    const res = await download(await cookieSessao(), "?versao=9");
    expect(res.status).toBe(404);
    expect(baixarMock).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "abc", "1.5", ""])("?versao=%j — 400, nunca toca banco de nota nem bucket", async (valor) => {
    configurarBanco();
    const res = await download(await cookieSessao(), `?versao=${valor}`);
    expect(res.status).toBe(400);
    expect(chamadaSql("from nota_fiscal")).toBeUndefined();
    expect(baixarMock).not.toHaveBeenCalled();
  });

  it("nota sem PDF — 404", async () => {
    configurarBanco({ pdfAtual: null });
    const res = await download(await cookieSessao());
    expect(res.status).toBe(404);
    expect((await res.json()).erro).toMatch(/não tem pdf anexado/i);
  });

  it("bucket indisponível — 502", async () => {
    configurarBanco({ pdfAtual: ATUAL });
    baixarMock.mockResolvedValue(null);
    expect((await download(await cookieSessao())).status).toBe(502);
  });
});
