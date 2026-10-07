// Testes unitários de POST/GET /api/notas/[id]/arquivo — upload/download
// do PDF da nota fiscal. Mocka @/lib/db (`query`) e @/lib/armazenamentoObjetos
// inteiro (nunca o SDK da AWS de verdade, nunca Postgres real) — o módulo
// de storage já é testado isoladamente em lib/armazenamentoObjetos.test.ts,
// e a persistência real das colunas novas é confirmada em
// lib/db.integration.test.ts. JWT_SECRET setado direto, mesmo padrão de
// lib/auth.test.ts — gera um cookie de sessão REAL (gerarAccessToken, não
// mockado) pra exercitar exigirSessao()/obterContextoAutenticado() de
// verdade nos casos de caminho feliz.

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "chave-de-teste-jwt-apenas-unitario";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: queryMock }));

const { uploadArquivoMock, gerarUrlDownloadMock } = vi.hoisted(() => ({
  uploadArquivoMock: vi.fn(),
  gerarUrlDownloadMock: vi.fn()
}));
vi.mock("@/lib/armazenamentoObjetos", () => ({
  uploadArquivo: uploadArquivoMock,
  gerarUrlDownload: gerarUrlDownloadMock
}));

import { NextRequest } from "next/server";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { GET, POST } from "./route";

const EQUIPE_ID = "equipe-1";
const NOTA_ID = "nota-1";
const TOKEN_VERSION = 1;

async function cookieSessaoValida(): Promise<string> {
  const token = await gerarAccessToken({ equipeId: EQUIPE_ID, nome: "Teste", precisaTrocarSenha: false, tokenVersion: TOKEN_VERSION });
  return `${NOME_COOKIE_ACCESS}=${token}`;
}

function pdfValido(nome = "nota.pdf"): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], nome, { type: "application/pdf" });
}

function requisicaoUpload(formData: FormData | null, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3001/api/notas/${NOTA_ID}/arquivo`, {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
    body: formData ?? undefined
  });
}

function requisicaoDownload(cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3001/api/notas/${NOTA_ID}/arquivo`, {
    method: "GET",
    headers: cookie ? { cookie } : undefined
  });
}

function chamar(fn: typeof POST | typeof GET, req: NextRequest) {
  return fn(req, { params: Promise.resolve({ id: NOTA_ID }) });
}

// Dispacha a resposta de `query` conforme o texto da SQL — mesmo padrão
// de criarQueryFake já usado em app/api/cron/verificar-prazos/route.test.ts.
function configurarQueryMock(opts: { notaExiste?: boolean; arquivoPdfChave?: string | null } = {}) {
  const { notaExiste = true, arquivoPdfChave = null } = opts;
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("from equipe_nexaigen")) {
      return [{ token_version: TOKEN_VERSION, ativo: true }];
    }
    if (sql.includes("select id from nota_fiscal")) {
      return notaExiste ? [{ id: NOTA_ID }] : [];
    }
    if (sql.includes("select arquivo_pdf_chave from nota_fiscal")) {
      return notaExiste ? [{ arquivo_pdf_chave: arquivoPdfChave }] : [];
    }
    if (sql.includes("update nota_fiscal set arquivo_pdf_chave")) {
      return [];
    }
    throw new Error(`queryMock: SQL não esperada neste teste: ${sql}`);
  });
}

beforeEach(() => {
  queryMock.mockReset();
  uploadArquivoMock.mockReset();
  gerarUrlDownloadMock.mockReset();
});

describe("POST /api/notas/[id]/arquivo", () => {
  it("sem sessão — 401, nunca chama query() nem uploadArquivo()", async () => {
    const formData = new FormData();
    formData.set("arquivo", pdfValido());

    const res = await chamar(POST, requisicaoUpload(formData));

    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
    expect(uploadArquivoMock).not.toHaveBeenCalled();
  });

  it("upload válido — 200, faz upload com a chave esperada e grava arquivo_pdf_chave/arquivo_pdf_nome", async () => {
    configurarQueryMock({ notaExiste: true });
    uploadArquivoMock.mockResolvedValue(true);
    const cookie = await cookieSessaoValida();
    const formData = new FormData();
    formData.set("arquivo", pdfValido("NF-e 123.pdf"));

    const res = await chamar(POST, requisicaoUpload(formData, cookie));
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo).toEqual({ ok: true, arquivo_pdf_nome: "NF-e 123.pdf" });

    expect(uploadArquivoMock).toHaveBeenCalledWith(
      `financeiro/notas-fiscais/${NOTA_ID}/NF-e_123.pdf`,
      expect.any(Buffer),
      "application/pdf"
    );

    const chamadaUpdate = queryMock.mock.calls.find((chamada: unknown[]) => (chamada[0] as string).includes("update nota_fiscal set arquivo_pdf_chave"));
    expect(chamadaUpdate).toBeDefined();
    expect(chamadaUpdate![1]).toEqual([`financeiro/notas-fiscais/${NOTA_ID}/NF-e_123.pdf`, "NF-e 123.pdf", NOTA_ID]);
  });

  it("nota fiscal inexistente — 404, nunca chama uploadArquivo()", async () => {
    configurarQueryMock({ notaExiste: false });
    const cookie = await cookieSessaoValida();
    const formData = new FormData();
    formData.set("arquivo", pdfValido());

    const res = await chamar(POST, requisicaoUpload(formData, cookie));

    expect(res.status).toBe(404);
    expect(uploadArquivoMock).not.toHaveBeenCalled();
  });

  it("Content-Type diferente de application/pdf — 400, nunca chama uploadArquivo()", async () => {
    configurarQueryMock({ notaExiste: true });
    const cookie = await cookieSessaoValida();
    const formData = new FormData();
    formData.set("arquivo", new File(["conteudo"], "malware.exe", { type: "application/x-msdownload" }));

    const res = await chamar(POST, requisicaoUpload(formData, cookie));

    expect(res.status).toBe(400);
    expect(uploadArquivoMock).not.toHaveBeenCalled();
  });

  it("assinatura do arquivo não é %PDF- mesmo com Content-Type application/pdf declarado — 400, nunca chama uploadArquivo() (nunca confia só no content-type)", async () => {
    configurarQueryMock({ notaExiste: true });
    const cookie = await cookieSessaoValida();
    const formData = new FormData();
    // Content-Type mente dizendo que é PDF, mas os bytes reais não começam com %PDF-.
    formData.set("arquivo", new File(["isto não é um pdf de verdade"], "fingido.pdf", { type: "application/pdf" }));

    const res = await chamar(POST, requisicaoUpload(formData, cookie));
    const corpo = await res.json();

    expect(res.status).toBe(400);
    expect(corpo.erro).toMatch(/assinatura/i);
    expect(uploadArquivoMock).not.toHaveBeenCalled();
  });

  it("arquivo maior que 10MB — 400, nunca chama uploadArquivo()", async () => {
    configurarQueryMock({ notaExiste: true });
    const cookie = await cookieSessaoValida();
    const bufferGrande = new Uint8Array(10 * 1024 * 1024 + 1);
    bufferGrande.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // assinatura válida — o limite é o único motivo de falha aqui
    const formData = new FormData();
    formData.set("arquivo", new File([bufferGrande], "grande.pdf", { type: "application/pdf" }));

    const res = await chamar(POST, requisicaoUpload(formData, cookie));

    expect(res.status).toBe(400);
    expect(uploadArquivoMock).not.toHaveBeenCalled();
  });

  it("armazenamento indisponível (uploadArquivo devolve false) — 502, nunca atualiza a nota", async () => {
    configurarQueryMock({ notaExiste: true });
    uploadArquivoMock.mockResolvedValue(false);
    const cookie = await cookieSessaoValida();
    const formData = new FormData();
    formData.set("arquivo", pdfValido());

    const res = await chamar(POST, requisicaoUpload(formData, cookie));

    expect(res.status).toBe(502);
    const chamadaUpdate = queryMock.mock.calls.find((chamada: unknown[]) => (chamada[0] as string).includes("update nota_fiscal set arquivo_pdf_chave"));
    expect(chamadaUpdate).toBeUndefined();
  });

  it("corpo não é multipart/form-data — 400", async () => {
    configurarQueryMock({ notaExiste: true });
    const cookie = await cookieSessaoValida();
    const req = new NextRequest(`http://localhost:3001/api/notas/${NOTA_ID}/arquivo`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}"
    });

    const res = await chamar(POST, req);
    expect(res.status).toBe(400);
  });

  it("campo 'arquivo' ausente — 400", async () => {
    configurarQueryMock({ notaExiste: true });
    const cookie = await cookieSessaoValida();
    const formData = new FormData();

    const res = await chamar(POST, requisicaoUpload(formData, cookie));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/notas/[id]/arquivo", () => {
  it("sem sessão — 401, nunca chama query() nem gerarUrlDownload()", async () => {
    const res = await chamar(GET, requisicaoDownload());
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
    expect(gerarUrlDownloadMock).not.toHaveBeenCalled();
  });

  it("nota fiscal inexistente — 404", async () => {
    configurarQueryMock({ notaExiste: false });
    const cookie = await cookieSessaoValida();

    const res = await chamar(GET, requisicaoDownload(cookie));
    expect(res.status).toBe(404);
  });

  it("nota existe mas sem arquivo anexado — 404, nunca chama gerarUrlDownload()", async () => {
    configurarQueryMock({ notaExiste: true, arquivoPdfChave: null });
    const cookie = await cookieSessaoValida();

    const res = await chamar(GET, requisicaoDownload(cookie));
    const corpo = await res.json();

    expect(res.status).toBe(404);
    expect(corpo.erro).toMatch(/não tem pdf anexado/i);
    expect(gerarUrlDownloadMock).not.toHaveBeenCalled();
  });

  it("nota com arquivo anexado — 200, devolve a URL presigned", async () => {
    configurarQueryMock({ notaExiste: true, arquivoPdfChave: `financeiro/notas-fiscais/${NOTA_ID}/nota.pdf` });
    gerarUrlDownloadMock.mockResolvedValue("https://bucket.example/presigned-url");
    const cookie = await cookieSessaoValida();

    const res = await chamar(GET, requisicaoDownload(cookie));
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo).toEqual({ url: "https://bucket.example/presigned-url" });
    expect(gerarUrlDownloadMock).toHaveBeenCalledWith(`financeiro/notas-fiscais/${NOTA_ID}/nota.pdf`);
  });

  it("armazenamento indisponível (gerarUrlDownload devolve null) — 502", async () => {
    configurarQueryMock({ notaExiste: true, arquivoPdfChave: `financeiro/notas-fiscais/${NOTA_ID}/nota.pdf` });
    gerarUrlDownloadMock.mockResolvedValue(null);
    const cookie = await cookieSessaoValida();

    const res = await chamar(GET, requisicaoDownload(cookie));
    expect(res.status).toBe(502);
  });
});
