// Download de PDF em streaming passando pelo código REAL do servidor do
// Next (next/dist/server/send-response.js) — rodada 13-A. Desde o Next
// 16.4.5 (GHSA-pc58-hwjq-p385) o servidor descarta content-length de
// respostas de route handlers; a garantia "nunca um PDF truncado entregue
// como completo" passou a depender de o Next DESTRUIR a conexão quando o
// stream do bucket falha no meio (sem o bloco final do chunked). Este teste
// prende esse comportamento: se um upgrade futuro do Next mudar isso, ele
// quebra. Servidor HTTP local em porta efêmera (127.0.0.1:0); bucket e
// banco mockados.

import { createServer, get, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { abrirMock } = vi.hoisted(() => ({ abrirMock: vi.fn() }));
vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("./armazenamentoObjetos", () => ({ uploadArquivo: vi.fn(), abrirLeituraArquivo: abrirMock, removerUploadNaoRegistrado: vi.fn() }));
vi.mock("./alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));

import { sendResponse } from "next/dist/server/send-response";
import { NodeNextRequest, NodeNextResponse } from "next/dist/server/base-http/node";
import { respostaDownloadPdf } from "./versionamentoPdf";

function streamDe(...pedacos: (Uint8Array | Error)[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controle) {
      const p = pedacos[i++];
      if (p === undefined) controle.close();
      else if (p instanceof Error) controle.error(p);
      else controle.enqueue(p);
    }
  });
}

let servidor: Server;
let porta: number;

beforeAll(async () => {
  servidor = createServer(async (req, res) => {
    const resposta = await respostaDownloadPdf("chave", "Nota.pdf");
    // Mesmo caminho do servidor do Next pra um route handler: sendResponse(NodeNextRequest, NodeNextResponse, Response).
    await sendResponse(new NodeNextRequest(req), new NodeNextResponse(res), resposta).catch(() => undefined);
  });
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  porta = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((fim) => servidor.close(() => fim()));
});

function baixar(): Promise<{ res: IncomingMessage; corpo: Buffer; completo: boolean }> {
  return new Promise((resolver, rejeitar) => {
    get(`http://127.0.0.1:${porta}/`, (res) => {
      const pedacos: Buffer[] = [];
      res.on("data", (p: Buffer) => pedacos.push(p));
      res.on("end", () => resolver({ res, corpo: Buffer.concat(pedacos), completo: res.complete }));
      res.on("error", () => resolver({ res, corpo: Buffer.concat(pedacos), completo: res.complete }));
      res.on("aborted", () => resolver({ res, corpo: Buffer.concat(pedacos), completo: false }));
    }).on("error", rejeitar);
  });
}

describe("download de PDF pelo servidor do Next", () => {
  it("transmissão completa: bytes idênticos, sem content-length (o Next descarta), chunked, cabeçalhos de segurança mantidos", async () => {
    const a = new TextEncoder().encode("%PDF-1.4 ");
    const b = new TextEncoder().encode("resto do arquivo");
    abrirMock.mockResolvedValue({ ok: true, corpo: streamDe(a, b), tamanhoBytes: a.length + b.length });

    const { res, corpo, completo } = await baixar();
    expect(res.statusCode).toBe(200);
    expect(completo).toBe(true);
    expect(corpo.equals(Buffer.concat([a, b]))).toBe(true);
    expect(res.headers["content-length"]).toBeUndefined();
    expect(res.headers["transfer-encoding"]).toBe("chunked");
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("bucket cai NO MEIO: o Next destrói a conexão — o cliente vê o download INCOMPLETO, nunca um PDF truncado como completo", async () => {
    abrirMock.mockResolvedValue({ ok: true, corpo: streamDe(new TextEncoder().encode("%PDF-1.4 começo"), new Error("ECONNRESET")), tamanhoBytes: 1000 });

    const { res, corpo, completo } = await baixar();
    // Quantos bytes saem antes do aborto depende do timing (pode ser zero); o que nunca pode acontecer é a resposta terminar "completa".
    expect(res.statusCode).toBe(200);
    expect("%PDF-1.4 começo".startsWith(corpo.toString())).toBe(true);
    expect(completo).toBe(false);
  });
});
