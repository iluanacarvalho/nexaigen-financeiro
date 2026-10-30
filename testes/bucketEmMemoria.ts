// Helper SÓ de teste: um "bucket" em memória com a MESMA interface de
// lib/armazenamentoObjetos.ts (upload, leitura em streaming, remoção do
// upload não registrado) — nunca o Railway de verdade. Uso nos testes de
// integração:
//
//   vi.mock("@/lib/armazenamentoObjetos", async () => (await import("@/testes/bucketEmMemoria")).armazenamentoEmMemoria);
//   import { bucketEmMemoria } from "@/testes/bucketEmMemoria";
//
// `bucketEmMemoria` expõe o estado (objetos, chaves removidas) e chaves
// pra simular falha: o próximo upload, a leitura de uma chave específica,
// ou um objeto que "some" (ausente).

const objetos = new Map<string, Buffer>();
const removidos: string[] = [];
const falhas = { proximoUpload: false, leituraIndisponivel: new Set<string>() };

export const bucketEmMemoria = {
  objetos,
  removidos,
  falhas,
  limpar() {
    objetos.clear();
    removidos.length = 0;
    falhas.proximoUpload = false;
    falhas.leituraIndisponivel.clear();
  }
};

/** Stream de um buffer em pedaços de 4 KB — pra o consumidor de fato ler aos poucos, como no S3. */
function streamDe(buffer: Buffer): ReadableStream<Uint8Array> {
  let posicao = 0;
  return new ReadableStream<Uint8Array>({
    pull(controle) {
      if (posicao >= buffer.length) return controle.close();
      controle.enqueue(new Uint8Array(buffer.subarray(posicao, posicao + 4096)));
      posicao += 4096;
    }
  });
}

export const armazenamentoEmMemoria = {
  uploadArquivo: async (chave: string, buffer: Buffer): Promise<boolean> => {
    if (falhas.proximoUpload) {
      falhas.proximoUpload = false;
      return false;
    }
    objetos.set(chave, Buffer.from(buffer));
    return true;
  },
  abrirLeituraArquivo: async (chave: string) => {
    if (falhas.leituraIndisponivel.has(chave)) return { ok: false as const, motivo: "indisponivel" as const };
    const conteudo = objetos.get(chave);
    if (!conteudo) return { ok: false as const, motivo: "ausente" as const };
    return { ok: true as const, corpo: streamDe(conteudo), tamanhoBytes: conteudo.length };
  },
  removerUploadNaoRegistrado: async (chave: string): Promise<boolean> => {
    removidos.push(chave);
    return objetos.delete(chave);
  }
};
