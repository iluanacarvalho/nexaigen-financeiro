// Testes unitários da rota POST/GET /api/notas/[id]/arquivo (PDF da nota fiscal, com
// versões). Desde a rodada 08 a rota só VALIDA e traduz em HTTP — o
// versionamento (bucket, transação, compensação, streaming) é
// lib/versionamentoPdf.ts, testado em lib/versionamentoPdf.test.ts e
// contra Postgres real em route.integration.test.ts. Aqui ele é mockado
// (as constantes ALVO_* continuam reais). Sessão REAL (gerarAccessToken).

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "chave-de-teste-jwt-apenas-unitario";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, donoExisteMock, registrarMock, localizarMock, downloadMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  donoExisteMock: vi.fn(),
  registrarMock: vi.fn(),
  localizarMock: vi.fn(),
  downloadMock: vi.fn()
}));
vi.mock("@/lib/db", () => ({ query: queryMock, withTransaction: vi.fn() }));
vi.mock("@/lib/versionamentoPdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/versionamentoPdf")>()),
  donoExiste: donoExisteMock,
  registrarVersaoPdf: registrarMock,
  localizarPdf: localizarMock,
  respostaDownloadPdf: downloadMock
}));

import { NextRequest } from "next/server";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { ALVO_PDF_NOTA } from "@/lib/versionamentoPdf";
import { GET, POST } from "./route";

const EQUIPE_ID = "7a1b2c3d-0000-4000-8000-000000000001";
const DONO_ID = "7a1b2c3d-0000-4000-8000-0000000000aa";

async function cookie(): Promise<string> {
  return `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId: EQUIPE_ID, nome: "Teste", precisaTrocarSenha: false, tokenVersion: 1 })}`;
}

const pdf = (nome = "doc.pdf", conteudo = "%PDF-1.4 x") => new File([conteudo], nome, { type: "application/pdf" });

function enviar(campos: { arquivo?: File; motivo?: string } | null, c?: string, id = DONO_ID) {
  let body: FormData | string;
  const headers: Record<string, string> = {};
  if (campos) {
    body = new FormData();
    if (campos.arquivo) body.set("arquivo", campos.arquivo);
    if (campos.motivo !== undefined) body.set("motivo", campos.motivo);
  } else {
    body = "{}";
    headers["content-type"] = "application/json";
  }
  if (c) headers.cookie = c;
  return POST(new NextRequest(`http://localhost:3001/api/notas/${id}/arquivo`, { method: "POST", headers, body }), { params: Promise.resolve({ id }) });
}

function baixar(c?: string, qs = "", id = DONO_ID) {
  return GET(new NextRequest(`http://localhost:3001/api/notas/${id}/arquivo${qs}`, { headers: c ? { cookie: c } : undefined }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  for (const m of [queryMock, donoExisteMock, registrarMock, localizarMock, downloadMock]) m.mockReset();
  queryMock.mockResolvedValue([{ token_version: 1, ativo: true, papel: "admin" }]); // só a checagem de sessão toca o banco aqui
  donoExisteMock.mockResolvedValue(true);
});

describe("POST — nova versão", () => {
  it("sem sessão → 401, nunca chega ao versionamento", async () => {
    expect((await enviar({ arquivo: pdf() })).status).toBe(401);
    expect(registrarMock).not.toHaveBeenCalled();
  });

  it("PDF válido + motivo → registra versão com o autor da SESSÃO e o motivo aparado", async () => {
    registrarMock.mockResolvedValue({ ok: true, versao: 3, tamanhoBytes: 10, sha256: "a".repeat(64) });
    const res = await enviar({ arquivo: pdf("Doc.pdf"), motivo: "  reemitido  " }, await cookie());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, versao: 3, arquivo_pdf_nome: "Doc.pdf", tamanho_bytes: 10, sha256: "a".repeat(64) });
    const [alvo, dono, arquivo] = registrarMock.mock.calls[0];
    expect(alvo).toBe(ALVO_PDF_NOTA);
    expect(dono).toBe(DONO_ID);
    expect(arquivo).toMatchObject({ nome: "Doc.pdf", motivo: "reemitido", enviadoPor: EQUIPE_ID });
  });

  it.each([
    ["bucket", 502],
    ["banco", 500],
    ["dono_inexistente", 404]
  ])("versionamento falhou (%s) → %i", async (motivo, status) => {
    registrarMock.mockResolvedValue({ ok: false, motivo });
    expect((await enviar({ arquivo: pdf() }, await cookie())).status).toBe(status);
  });

  it.each([
    ["tipo diferente de PDF", { arquivo: new File(["%PDF-1.4"], "a.exe", { type: "application/x-msdownload" }) }],
    ["assinatura não é %PDF-", { arquivo: new File(["não é pdf"], "f.pdf", { type: "application/pdf" }) }],
    ["sem arquivo", {}],
    ["motivo com 301 caracteres", { arquivo: pdf(), motivo: "a".repeat(301) }]
  ])("%s → 400, nunca chega ao versionamento", async (_d, campos) => {
    expect((await enviar(campos, await cookie())).status).toBe(400);
    expect(registrarMock).not.toHaveBeenCalled();
  });

  it("corpo não multipart → 400", async () => {
    expect((await enviar(null, await cookie())).status).toBe(400);
  });

  it("Nota fiscal inexistente → 404; id que não é uuid → 404 sem consultar o dono", async () => {
    donoExisteMock.mockResolvedValue(false);
    const c = await cookie();
    expect((await enviar({ arquivo: pdf() }, c)).status).toBe(404);
    donoExisteMock.mockClear();
    expect((await enviar({ arquivo: pdf() }, c, "nao-uuid")).status).toBe(404);
    expect(donoExisteMock).not.toHaveBeenCalled();
    expect(registrarMock).not.toHaveBeenCalled();
  });
});

describe("GET — download (streaming via lib/versionamentoPdf.ts#respostaDownloadPdf)", () => {
  it("sem sessão → 401", async () => {
    expect((await baixar()).status).toBe(401);
    expect(localizarMock).not.toHaveBeenCalled();
  });

  it("sem ?versao → versão atual; com ?versao=2 → aquela versão; resposta é a do download em streaming", async () => {
    localizarMock.mockResolvedValue({ status: "ok", chave: "k", nome: "a.pdf" });
    const resposta = new Response("pdf");
    downloadMock.mockResolvedValue(resposta);
    const c = await cookie();

    expect(await baixar(c)).toBe(resposta);
    expect(localizarMock).toHaveBeenLastCalledWith(ALVO_PDF_NOTA, DONO_ID, null);
    await baixar(c, "?versao=2");
    expect(localizarMock).toHaveBeenLastCalledWith(ALVO_PDF_NOTA, DONO_ID, 2);
    expect(downloadMock).toHaveBeenCalledWith("k", "a.pdf");
  });

  it.each([
    ["dono_inexistente", 404],
    ["sem_arquivo", 404],
    ["versao_inexistente", 404]
  ])("%s → %i, nunca abre o download", async (status, http) => {
    localizarMock.mockResolvedValue({ status });
    expect((await baixar(await cookie(), status === "versao_inexistente" ? "?versao=9" : "")).status).toBe(http);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("sem arquivo → mensagem clara", async () => {
    localizarMock.mockResolvedValue({ status: "sem_arquivo" });
    expect((await (await baixar(await cookie())).json()).erro).toContain("não tem PDF anexado");
  });

  it.each(["0", "-1", "abc", "1.5", ""])("?versao=%j → 400, nunca localiza", async (v) => {
    expect((await baixar(await cookie(), `?versao=${v}`)).status).toBe(400);
    expect(localizarMock).not.toHaveBeenCalled();
  });
});
