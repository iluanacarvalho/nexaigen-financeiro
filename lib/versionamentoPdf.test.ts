// Testes unitários de lib/versionamentoPdf.ts — o versionamento
// compartilhado do PDF da nota (0005) e do contrato (0009). @/lib/db,
// armazenamentoObjetos e alertaErroSistema mockados; Postgres real e lock
// por dono em app/api/notas/[id]/arquivo/route.integration.test.ts e
// app/api/clientes/[id]/contrato/route.integration.test.ts.

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, withTransactionMock, uploadMock, abrirMock, removerMock, alertarMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  withTransactionMock: vi.fn(),
  uploadMock: vi.fn(),
  abrirMock: vi.fn(),
  removerMock: vi.fn(),
  alertarMock: vi.fn()
}));
vi.mock("./db", () => ({ query: queryMock, withTransaction: withTransactionMock }));
vi.mock("./armazenamentoObjetos", () => ({ uploadArquivo: uploadMock, abrirLeituraArquivo: abrirMock, removerUploadNaoRegistrado: removerMock }));
vi.mock("./alertaErroSistema", () => ({ alertarErroSistema: alertarMock }));

import { ALVO_CONTRATO, ALVO_PDF_NOTA, localizarPdf, registrarVersaoPdf, respostaDownloadPdf, type AlvoVersionamento } from "./versionamentoPdf";

const DONO = "7a1b2c3d-0000-4000-8000-0000000000aa";
const CONTEUDO = Buffer.from("%PDF-1.4 conteúdo de teste");
const SHA = createHash("sha256").update(CONTEUDO).digest("hex");

function configurarBanco(opts: { donoExiste?: boolean; maior?: number | null; falharInsert?: boolean } = {}) {
  const { donoExiste = true, maior = null, falharInsert = false } = opts;
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("for update")) return donoExiste ? [{ id: DONO }] : [];
    if (sql.includes("select max(versao)")) return [{ maior }];
    if (sql.startsWith("insert into")) {
      if (falharInsert) throw Object.assign(new Error("conexão caiu"), { code: "57P01" });
      return [];
    }
    if (sql.startsWith("update")) return [];
    throw new Error(`SQL não esperada: ${sql}`);
  });
  withTransactionMock.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => fn({}));
}

const sqlCom = (trecho: string) => queryMock.mock.calls.find((c: unknown[]) => (c[0] as string).includes(trecho));

beforeEach(() => {
  for (const m of [queryMock, withTransactionMock, uploadMock, abrirMock, removerMock, alertarMock]) m.mockReset();
});

describe.each([
  ["PDF da nota fiscal", ALVO_PDF_NOTA, "financeiro/notas-fiscais", "nota_fiscal_arquivo_versao", "nota_fiscal", "arquivo_pdf_chave"],
  ["contrato da prefeitura", ALVO_CONTRATO, "financeiro/contratos-prefeitura", "cliente_contrato_versao", "cliente_prefeitura", "contrato_arquivo_chave"]
] as [string, AlvoVersionamento, string, string, string, string][])("registrarVersaoPdf — %s", (_nome, alvo, prefixo, tabelaVersao, tabelaDono, colunaChave) => {
  it("primeiro envio = v1: chave única por envio, sha256/tamanho/autor/motivo gravados, ponteiro movido na mesma transação", async () => {
    configurarBanco({ maior: null });
    uploadMock.mockResolvedValue(true);

    const r = await registrarVersaoPdf(alvo, DONO, { buffer: CONTEUDO, nome: "Doc 1.pdf", motivo: "primeiro", enviadoPor: "equipe-1" });

    expect(r).toEqual({ ok: true, versao: 1, tamanhoBytes: CONTEUDO.length, sha256: SHA });
    const [chave] = uploadMock.mock.calls[0];
    expect(chave).toMatch(new RegExp(`^${prefixo}/${DONO}/versoes/[0-9a-f-]{36}/Doc_1\\.pdf$`));
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(sqlCom(`select id from ${tabelaDono} where id = $1 for update`)).toBeDefined();
    expect(sqlCom(`insert into ${tabelaVersao}`)![1]).toEqual([DONO, 1, chave, "Doc 1.pdf", CONTEUDO.length, SHA, "equipe-1", "primeiro"]);
    expect(sqlCom(`update ${tabelaDono} set ${colunaChave}`)![1]).toEqual([chave, "Doc 1.pdf", DONO]);
    expect(removerMock).not.toHaveBeenCalled();
  });

  it("já há 2 versões → v3; dois envios nunca reutilizam a mesma chave", async () => {
    configurarBanco({ maior: 2 });
    uploadMock.mockResolvedValue(true);
    const a = await registrarVersaoPdf(alvo, DONO, { buffer: CONTEUDO, nome: "x.pdf", motivo: null, enviadoPor: null });
    await registrarVersaoPdf(alvo, DONO, { buffer: CONTEUDO, nome: "x.pdf", motivo: null, enviadoPor: null });
    expect(a).toMatchObject({ ok: true, versao: 3 });
    expect(uploadMock.mock.calls[0][0]).not.toBe(uploadMock.mock.calls[1][0]);
  });

  it("falha no bucket → nada no banco (sem versão fantasma)", async () => {
    configurarBanco();
    uploadMock.mockResolvedValue(false);
    expect(await registrarVersaoPdf(alvo, DONO, { buffer: CONTEUDO, nome: "x.pdf", motivo: null, enviadoPor: null })).toEqual({ ok: false, motivo: "bucket" });
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("falha no banco depois do upload → remove o objeto recém-enviado, sem alerta se a limpeza deu certo", async () => {
    configurarBanco({ falharInsert: true });
    uploadMock.mockResolvedValue(true);
    removerMock.mockResolvedValue(true);
    expect(await registrarVersaoPdf(alvo, DONO, { buffer: CONTEUDO, nome: "x.pdf", motivo: null, enviadoPor: null })).toEqual({ ok: false, motivo: "banco" });
    expect(removerMock).toHaveBeenCalledWith(uploadMock.mock.calls[0][0]);
    expect(alertarMock).not.toHaveBeenCalled();
  });

  it("falha no banco E na limpeza → alertarErroSistema com o prefixo do órfão, nunca o nome do arquivo", async () => {
    configurarBanco({ falharInsert: true });
    uploadMock.mockResolvedValue(true);
    removerMock.mockResolvedValue(false);
    await registrarVersaoPdf(alvo, DONO, { buffer: CONTEUDO, nome: "Documento de Fulano.pdf", motivo: null, enviadoPor: null });
    const [categoria, mensagem] = alertarMock.mock.calls[0];
    expect(categoria).toBe(alvo.categoriaAlerta);
    expect(mensagem).toContain(`${prefixo}/${DONO}/versoes/`);
    expect(mensagem).not.toContain("Fulano");
  });

  it("dono removido no meio do envio → dono_inexistente e o objeto é removido", async () => {
    configurarBanco({ donoExiste: false });
    uploadMock.mockResolvedValue(true);
    removerMock.mockResolvedValue(true);
    expect(await registrarVersaoPdf(alvo, DONO, { buffer: CONTEUDO, nome: "x.pdf", motivo: null, enviadoPor: null })).toEqual({ ok: false, motivo: "dono_inexistente" });
    expect(removerMock).toHaveBeenCalled();
  });
});

describe("localizarPdf", () => {
  it("sem versão → ponteiro atual do dono; com versão → a linha daquela versão", async () => {
    queryMock.mockResolvedValueOnce([{ chave: "k-atual", nome: "atual.pdf" }]);
    expect(await localizarPdf(ALVO_CONTRATO, DONO, null)).toEqual({ status: "ok", chave: "k-atual", nome: "atual.pdf" });
    expect(queryMock.mock.calls[0][0]).toContain("select contrato_arquivo_chave as chave, contrato_arquivo_nome as nome from cliente_prefeitura");

    queryMock.mockResolvedValueOnce([{ chave: "k-v1", nome: "v1.pdf" }]);
    expect(await localizarPdf(ALVO_CONTRATO, DONO, 1)).toEqual({ status: "ok", chave: "k-v1", nome: "v1.pdf" });
    expect(queryMock.mock.calls[1][1]).toEqual([DONO, 1]);
  });

  it("dono inexistente, sem arquivo, versão inexistente", async () => {
    queryMock.mockResolvedValueOnce([]);
    expect(await localizarPdf(ALVO_PDF_NOTA, DONO, null)).toEqual({ status: "dono_inexistente" });
    queryMock.mockResolvedValueOnce([{ chave: null, nome: null }]);
    expect(await localizarPdf(ALVO_PDF_NOTA, DONO, null)).toEqual({ status: "sem_arquivo" });
    queryMock.mockResolvedValueOnce([]);
    expect(await localizarPdf(ALVO_PDF_NOTA, DONO, 7)).toEqual({ status: "versao_inexistente" });
  });
});

describe("respostaDownloadPdf — streaming", () => {
  function streamDe(...pedacos: (Uint8Array | Error)[]): ReadableStream<Uint8Array> {
    let i = 0;
    return new ReadableStream<Uint8Array>({
      pull(controle) {
        const p = pedacos[i++];
        if (p === undefined) controle.close();
        else if (p instanceof Error) controle.error(p);
        else controle.enqueue(p);
      }
    });
  }

  it("repassa o corpo do bucket byte a byte, application/pdf, nosniff, no-store e nome sanitizado — sem Content-Length (o Next 16.4.5+ descarta; ver lib/downloadPdfNoServidorNext.test.ts)", async () => {
    const a = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const b = new TextEncoder().encode("1.4 resto do arquivo");
    abrirMock.mockResolvedValue({ ok: true, corpo: streamDe(a, b), tamanhoBytes: a.length + b.length });

    const res = await respostaDownloadPdf("k", "NF Jaguapitã.pdf");

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.concat([a, b]))).toBe(true);
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="NF_Jaguapit_.pdf"; filename*=UTF-8''NF%20Jaguapit%C3%A3.pdf`);
  });

  it("bucket indisponível ANTES de transmitir → 502 JSON, nenhum byte de PDF", async () => {
    abrirMock.mockResolvedValue({ ok: false, motivo: "indisponivel" });
    const res = await respostaDownloadPdf("k", "a.pdf");
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.text()).not.toContain("%PDF");
  });

  it("objeto sumiu do bucket → 404", async () => {
    abrirMock.mockResolvedValue({ ok: false, motivo: "ausente" });
    expect((await respostaDownloadPdf("k", "a.pdf")).status).toBe(404);
  });

  it("conexão com o bucket cai NO MEIO → a leitura do corpo falha (nunca um PDF truncado entregue como completo)", async () => {
    abrirMock.mockResolvedValue({ ok: true, corpo: streamDe(new Uint8Array([0x25, 0x50]), new Error("ECONNRESET")), tamanhoBytes: 1000 });
    const res = await respostaDownloadPdf("k", "a.pdf");
    await expect(res.arrayBuffer()).rejects.toThrow();
  });
});
