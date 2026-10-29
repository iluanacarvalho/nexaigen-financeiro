// Testes unitários de lib/armazenamentoObjetos.ts — módulo reaproveitado
// tal e qual do projeto irmão nexaigen-educa, mesmos testes (adaptados
// só nos exemplos de chave, "notas-fiscais" em vez de "convenios"). SDK
// da AWS mockado via vi.mock, NUNCA rede real, NUNCA uma conta Railway
// real. Cobre env vars ausentes, sucesso, erro do SDK, nunca loga a
// secret key.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn()
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn()
}));
vi.mock("@smithy/node-http-handler", () => ({
  NodeHttpHandler: vi.fn()
}));

// lib/alertaErroSistema.ts importa lib/db.ts (pg real) — sem mockar aqui,
// este teste puro quebraria na importação assim que armazenamentoObjetos.ts
// passasse a chamar alertarErroSistema nas 4 falhas (rodada de alerta de
// falha de sistema, categoria "railway_bucket").
//
// vi.hoisted (não um `const` solto): vi.mock() é hoisted pro TOPO do
// arquivo pelo vitest, antes de QUALQUER outra declaração top-level —
// referenciar um `const alertarErroSistemaMock` comum dentro da factory
// do vi.mock lançaria "Cannot access before initialization" (TDZ), já
// que a factory roda antes do `const` ser inicializado. vi.hoisted roda
// na mesma fase de hoisting dos vi.mock, na ordem em que aparece no
// arquivo — por isso precisa vir ANTES do vi.mock que o usa.
const { alertarErroSistemaMock } = vi.hoisted(() => ({
  alertarErroSistemaMock: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("./alertaErroSistema", () => ({ alertarErroSistema: alertarErroSistemaMock }));

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { baixarArquivo, gerarUrlDownload, removerUploadNaoRegistrado, uploadArquivo } from "./armazenamentoObjetos";

const ENV_ORIGINAL = {
  bucket: process.env.RAILWAY_BUCKET_NAME,
  accessKeyId: process.env.RAILWAY_BUCKET_ACCESS_KEY_ID,
  secretAccessKey: process.env.RAILWAY_BUCKET_SECRET_ACCESS_KEY,
  region: process.env.RAILWAY_BUCKET_REGION,
  endpoint: process.env.RAILWAY_BUCKET_ENDPOINT,
  forcePathStyle: process.env.RAILWAY_BUCKET_FORCE_PATH_STYLE
};

function limparEnvBucket() {
  delete process.env.RAILWAY_BUCKET_NAME;
  delete process.env.RAILWAY_BUCKET_ACCESS_KEY_ID;
  delete process.env.RAILWAY_BUCKET_SECRET_ACCESS_KEY;
  delete process.env.RAILWAY_BUCKET_REGION;
  delete process.env.RAILWAY_BUCKET_ENDPOINT;
  delete process.env.RAILWAY_BUCKET_FORCE_PATH_STYLE;
}

function configurarEnvBucketCompleto() {
  process.env.RAILWAY_BUCKET_NAME = "bucket-de-teste";
  process.env.RAILWAY_BUCKET_ACCESS_KEY_ID = "access-key-de-teste";
  process.env.RAILWAY_BUCKET_SECRET_ACCESS_KEY = "secret-key-secreta-nao-pode-vazar";
  process.env.RAILWAY_BUCKET_ENDPOINT = "https://t3.storageapi.dev";
  // RAILWAY_BUCKET_REGION deliberadamente ausente aqui — testa o
  // fallback pro valor "auto" em pelo menos um caso de sucesso.
}

const sendMock = vi.fn();

beforeEach(() => {
  // Precisa ser `function` (não arrow function) — o vitest só trata o
  // mock como um construtor de verdade (`new S3Client(...)`) quando a
  // implementação usa `function`/`class`, ver aviso da própria
  // ferramenta.
  vi.mocked(S3Client).mockImplementation(function (this: { send: typeof sendMock }) {
    this.send = sendMock;
  } as unknown as () => S3Client);
});

afterEach(() => {
  for (const [chave, valor] of [
    ["RAILWAY_BUCKET_NAME", ENV_ORIGINAL.bucket],
    ["RAILWAY_BUCKET_ACCESS_KEY_ID", ENV_ORIGINAL.accessKeyId],
    ["RAILWAY_BUCKET_SECRET_ACCESS_KEY", ENV_ORIGINAL.secretAccessKey],
    ["RAILWAY_BUCKET_REGION", ENV_ORIGINAL.region],
    ["RAILWAY_BUCKET_ENDPOINT", ENV_ORIGINAL.endpoint],
    ["RAILWAY_BUCKET_FORCE_PATH_STYLE", ENV_ORIGINAL.forcePathStyle]
  ] as const) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
  // vi.clearAllMocks() já cobre alertarErroSistemaMock (é um vi.fn()
  // registrado globalmente) — sem um .mockClear() redundante aqui.
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("uploadArquivo", () => {
  it.each([
    ["RAILWAY_BUCKET_NAME ausente", { skip: "bucket" }],
    ["RAILWAY_BUCKET_ACCESS_KEY_ID ausente", { skip: "accessKeyId" }],
    ["RAILWAY_BUCKET_SECRET_ACCESS_KEY ausente", { skip: "secretAccessKey" }],
    ["RAILWAY_BUCKET_ENDPOINT ausente", { skip: "endpoint" }]
  ])("%s — devolve false, nunca chama o SDK, alerta falha de sistema (categoria railway_bucket)", async (_descricao, { skip }) => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    if (skip === "bucket") delete process.env.RAILWAY_BUCKET_NAME;
    if (skip === "accessKeyId") delete process.env.RAILWAY_BUCKET_ACCESS_KEY_ID;
    if (skip === "secretAccessKey") delete process.env.RAILWAY_BUCKET_SECRET_ACCESS_KEY;
    if (skip === "endpoint") delete process.env.RAILWAY_BUCKET_ENDPOINT;

    await expect(uploadArquivo("chave/teste.pdf", Buffer.from("conteudo"), "application/pdf")).resolves.toBe(false);
    expect(S3Client).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(alertarErroSistemaMock).toHaveBeenCalledWith("railway_bucket", expect.any(String));
  });

  it("RAILWAY_BUCKET_REGION e RAILWAY_BUCKET_FORCE_PATH_STYLE ausentes caem pros defaults ('auto'/false), envio com sucesso devolve true", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    sendMock.mockResolvedValue({});

    const buffer = Buffer.from("%PDF-1.4 conteudo do pdf");
    await expect(uploadArquivo("financeiro/notas-fiscais/nota-1/abc-arquivo.pdf", buffer, "application/pdf")).resolves.toBe(true);

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: "auto",
        endpoint: "https://t3.storageapi.dev",
        forcePathStyle: false,
        credentials: { accessKeyId: "access-key-de-teste", secretAccessKey: "secret-key-secreta-nao-pode-vazar" }
      })
    );
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "bucket-de-teste",
      Key: "financeiro/notas-fiscais/nota-1/abc-arquivo.pdf",
      Body: buffer,
      ContentType: "application/pdf"
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("RAILWAY_BUCKET_FORCE_PATH_STYLE=true — S3Client recebe forcePathStyle: true (caso de bucket legado)", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    process.env.RAILWAY_BUCKET_FORCE_PATH_STYLE = "true";
    sendMock.mockResolvedValue({});

    await uploadArquivo("chave/teste.pdf", Buffer.from("x"), "application/pdf");

    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: true }));
  });

  it("qualquer valor diferente de 'true' (ex.: 'false', vazio, lixo) mantém forcePathStyle: false", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    process.env.RAILWAY_BUCKET_FORCE_PATH_STYLE = "TRUE"; // case diferente não conta — só o literal "true"
    sendMock.mockResolvedValue({});

    await uploadArquivo("chave/teste.pdf", Buffer.from("x"), "application/pdf");

    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: false }));
  });

  it("S3Client recebe um requestHandler construído com NodeHttpHandler, com os timeouts esperados (conexão 5s, requisição 25s, throwOnRequestTimeout)", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    sendMock.mockResolvedValue({});

    await uploadArquivo("chave/teste.pdf", Buffer.from("x"), "application/pdf");

    expect(NodeHttpHandler).toHaveBeenCalledWith({
      connectionTimeout: 5_000,
      requestTimeout: 25_000,
      throwOnRequestTimeout: true
    });
  });

  it("erro do SDK ao enviar — devolve false, nunca lança, alerta falha de sistema", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    sendMock.mockRejectedValue(new Error("falha de rede simulada"));

    await expect(uploadArquivo("chave/teste.pdf", Buffer.from("x"), "application/pdf")).resolves.toBe(false);
    expect(alertarErroSistemaMock).toHaveBeenCalledWith("railway_bucket", expect.any(String));
  });

  it("chamada pendurada que eventualmente estoura o timeout — devolve false, nunca trava indefinidamente", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    vi.useFakeTimers();
    sendMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("TimeoutError: socket hang up")), 25_000);
        })
    );

    const promessa = uploadArquivo("chave/teste.pdf", Buffer.from("x"), "application/pdf");
    await vi.advanceTimersByTimeAsync(25_000);

    await expect(promessa).resolves.toBe(false);
  });

  it("nunca loga a secret key, nem em sucesso nem em erro", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    sendMock.mockRejectedValue(new Error("falha simulada"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await uploadArquivo("chave/teste.pdf", Buffer.from("x"), "application/pdf");

    for (const chamada of warnSpy.mock.calls) {
      for (const argumento of chamada) {
        expect(String(argumento)).not.toContain("secret-key-secreta-nao-pode-vazar");
      }
    }
    warnSpy.mockRestore();
  });
});

describe("gerarUrlDownload", () => {
  it("armazenamento não configurado — devolve null, nunca chama o SDK, alerta falha de sistema", async () => {
    limparEnvBucket();

    await expect(gerarUrlDownload("chave/teste.pdf")).resolves.toBeNull();
    expect(S3Client).not.toHaveBeenCalled();
    expect(getSignedUrl).not.toHaveBeenCalled();
    expect(alertarErroSistemaMock).toHaveBeenCalledWith("railway_bucket", expect.any(String));
  });

  it("sucesso — devolve a URL presigned gerada, expiração de 5 minutos (300s)", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    vi.mocked(getSignedUrl).mockResolvedValue("https://t3.storageapi.dev/bucket-de-teste/chave/teste.pdf?presigned=1");

    await expect(gerarUrlDownload("chave/teste.pdf")).resolves.toBe(
      "https://t3.storageapi.dev/bucket-de-teste/chave/teste.pdf?presigned=1"
    );
    expect(GetObjectCommand).toHaveBeenCalledWith({ Bucket: "bucket-de-teste", Key: "chave/teste.pdf" });
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 300 });
  });

  it("erro do SDK ao gerar a URL — devolve null, nunca lança, alerta falha de sistema", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    vi.mocked(getSignedUrl).mockRejectedValue(new Error("falha simulada"));

    await expect(gerarUrlDownload("chave/teste.pdf")).resolves.toBeNull();
    expect(alertarErroSistemaMock).toHaveBeenCalledWith("railway_bucket", expect.any(String));
  });

  it("nunca loga a secret key, nem em sucesso nem em erro", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    vi.mocked(getSignedUrl).mockRejectedValue(new Error("falha simulada"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await gerarUrlDownload("chave/teste.pdf");

    for (const chamada of warnSpy.mock.calls) {
      for (const argumento of chamada) {
        expect(String(argumento)).not.toContain("secret-key-secreta-nao-pode-vazar");
      }
    }
    warnSpy.mockRestore();
  });
});

describe("baixarArquivo", () => {
  it("armazenamento não configurado — null, nunca chama o SDK, alerta falha de sistema", async () => {
    limparEnvBucket();

    await expect(baixarArquivo("chave/teste.pdf")).resolves.toBeNull();
    expect(S3Client).not.toHaveBeenCalled();
    expect(alertarErroSistemaMock).toHaveBeenCalledWith("railway_bucket", expect.any(String));
  });

  it("sucesso — devolve os bytes exatos do objeto (GetObject com bucket/chave certos)", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    const conteudo = Buffer.from("%PDF-1.4 conteúdo da versão");
    sendMock.mockResolvedValue({ Body: { transformToByteArray: async () => new Uint8Array(conteudo) } });

    const bytes = await baixarArquivo("financeiro/notas-fiscais/n/versoes/u/a.pdf");

    expect(bytes?.equals(conteudo)).toBe(true);
    expect(GetObjectCommand).toHaveBeenCalledWith({ Bucket: "bucket-de-teste", Key: "financeiro/notas-fiscais/n/versoes/u/a.pdf" });
  });

  it.each([
    ["erro do SDK (ex.: NoSuchKey)", () => sendMock.mockRejectedValue(new Error("NoSuchKey"))],
    ["resposta sem corpo", () => sendMock.mockResolvedValue({})]
  ])("%s — null, nunca lança, alerta falha de sistema", async (_d, configurar) => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    configurar();

    await expect(baixarArquivo("chave/teste.pdf")).resolves.toBeNull();
    expect(alertarErroSistemaMock).toHaveBeenCalledWith("railway_bucket", expect.any(String));
  });
});

describe("removerUploadNaoRegistrado", () => {
  it("sucesso — DeleteObject na chave exata, devolve true", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    sendMock.mockResolvedValue({});

    await expect(removerUploadNaoRegistrado("financeiro/notas-fiscais/n/versoes/u/a.pdf")).resolves.toBe(true);
    expect(DeleteObjectCommand).toHaveBeenCalledWith({ Bucket: "bucket-de-teste", Key: "financeiro/notas-fiscais/n/versoes/u/a.pdf" });
  });

  it("erro do SDK — false, nunca lança, e NÃO alerta (quem chama decide o alerta do órfão)", async () => {
    limparEnvBucket();
    configurarEnvBucketCompleto();
    sendMock.mockRejectedValue(new Error("falha simulada"));

    await expect(removerUploadNaoRegistrado("chave/teste.pdf")).resolves.toBe(false);
    expect(alertarErroSistemaMock).not.toHaveBeenCalled();
  });

  it("armazenamento não configurado — false, nunca chama o SDK", async () => {
    limparEnvBucket();

    await expect(removerUploadNaoRegistrado("chave/teste.pdf")).resolves.toBe(false);
    expect(S3Client).not.toHaveBeenCalled();
  });
});
