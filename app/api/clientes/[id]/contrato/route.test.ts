// Testes unitários de POST/GET /api/clientes/[id]/contrato — mesmo
// desenho de app/api/notas/[id]/arquivo/route.test.ts: @/lib/db e
// @/lib/armazenamentoObjetos mockados, cookie de sessão REAL
// (gerarAccessToken) pra exercitar exigirSessao() de verdade.

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "chave-de-teste-jwt-apenas-unitario";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, uploadArquivoMock, gerarUrlDownloadMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  uploadArquivoMock: vi.fn(),
  gerarUrlDownloadMock: vi.fn()
}));
vi.mock("@/lib/db", () => ({ query: queryMock }));
vi.mock("@/lib/armazenamentoObjetos", () => ({ uploadArquivo: uploadArquivoMock, gerarUrlDownload: gerarUrlDownloadMock }));

import { NextRequest } from "next/server";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { GET, POST } from "./route";

const CLIENTE_ID = "0b6c5c0e-2f7d-4d8e-9a1b-3c4d5e6f7a8b";
const TOKEN_VERSION = 1;

async function cookie(): Promise<string> {
  const token = await gerarAccessToken({ equipeId: "equipe-1", nome: "Teste", precisaTrocarSenha: false, tokenVersion: TOKEN_VERSION });
  return `${NOME_COOKIE_ACCESS}=${token}`;
}

function configurarQuery(opts: { existe?: boolean; chave?: string | null } = {}) {
  const { existe = true, chave = null } = opts;
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("from equipe_nexaigen")) return [{ token_version: TOKEN_VERSION, ativo: true }];
    if (sql.includes("select id from cliente_prefeitura")) return existe ? [{ id: CLIENTE_ID }] : [];
    if (sql.includes("select contrato_arquivo_chave")) return existe ? [{ contrato_arquivo_chave: chave }] : [];
    if (sql.includes("update cliente_prefeitura set contrato_arquivo_chave")) return [];
    throw new Error(`SQL não esperada: ${sql}`);
  });
}

function upload(arquivo: File | null, c?: string) {
  const fd = new FormData();
  if (arquivo) fd.set("arquivo", arquivo);
  return POST(
    new NextRequest(`http://localhost:3001/api/clientes/${CLIENTE_ID}/contrato`, { method: "POST", headers: c ? { cookie: c } : undefined, body: fd }),
    { params: Promise.resolve({ id: CLIENTE_ID }) }
  );
}

function download(c?: string) {
  return GET(new NextRequest(`http://localhost:3001/api/clientes/${CLIENTE_ID}/contrato`, { headers: c ? { cookie: c } : undefined }), {
    params: Promise.resolve({ id: CLIENTE_ID })
  });
}

const pdf = (nome = "contrato.pdf") => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], nome, { type: "application/pdf" });

beforeEach(() => {
  queryMock.mockReset();
  uploadArquivoMock.mockReset();
  gerarUrlDownloadMock.mockReset();
});

describe("POST /api/clientes/[id]/contrato", () => {
  it("sem sessão — 401, nunca chama query()/upload", async () => {
    const res = await upload(pdf());
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
    expect(uploadArquivoMock).not.toHaveBeenCalled();
  });

  it("PDF válido — upload em financeiro/contratos-prefeitura/{clienteId}/ e grava chave/nome", async () => {
    configurarQuery();
    uploadArquivoMock.mockResolvedValue(true);

    const res = await upload(pdf("Contrato 2026.pdf"), await cookie());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, contrato_arquivo_nome: "Contrato 2026.pdf" });

    const chave = `financeiro/contratos-prefeitura/${CLIENTE_ID}/Contrato_2026.pdf`;
    expect(uploadArquivoMock).toHaveBeenCalledWith(chave, expect.any(Buffer), "application/pdf");
    const update = queryMock.mock.calls.find((c: unknown[]) => (c[0] as string).includes("update cliente_prefeitura"));
    expect(update![1]).toEqual([chave, "Contrato 2026.pdf", CLIENTE_ID]);
  });

  it("assinatura não é %PDF- — 400, nunca faz upload", async () => {
    configurarQuery();
    const res = await upload(new File(["não é pdf"], "fingido.pdf", { type: "application/pdf" }), await cookie());
    expect(res.status).toBe(400);
    expect((await res.json()).erro).toMatch(/assinatura/i);
    expect(uploadArquivoMock).not.toHaveBeenCalled();
  });

  it("tipo diferente de application/pdf — 400", async () => {
    configurarQuery();
    const res = await upload(new File(["x"], "a.docx", { type: "application/msword" }), await cookie());
    expect(res.status).toBe(400);
    expect(uploadArquivoMock).not.toHaveBeenCalled();
  });

  it("cliente inexistente — 404", async () => {
    configurarQuery({ existe: false });
    const res = await upload(pdf(), await cookie());
    expect(res.status).toBe(404);
    expect(uploadArquivoMock).not.toHaveBeenCalled();
  });

  it("armazenamento indisponível — 502, nunca grava metadados", async () => {
    configurarQuery();
    uploadArquivoMock.mockResolvedValue(false);
    const res = await upload(pdf(), await cookie());
    expect(res.status).toBe(502);
    expect(queryMock.mock.calls.some((c: unknown[]) => (c[0] as string).includes("update cliente_prefeitura"))).toBe(false);
  });
});

describe("GET /api/clientes/[id]/contrato", () => {
  it("sem sessão — 401", async () => {
    const res = await download();
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("sem contrato anexado — 404, nunca gera URL", async () => {
    configurarQuery({ chave: null });
    const res = await download(await cookie());
    expect(res.status).toBe(404);
    expect(gerarUrlDownloadMock).not.toHaveBeenCalled();
  });

  it("com contrato — 200 { url } (presigned, nunca redirect)", async () => {
    configurarQuery({ chave: "financeiro/contratos-prefeitura/x/contrato.pdf" });
    gerarUrlDownloadMock.mockResolvedValue("https://bucket.example/presigned");
    const res = await download(await cookie());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://bucket.example/presigned" });
  });
});
