// Armazenamento de objetos — REAPROVEITADO tal e qual do projeto irmão
// nexaigen-educa (lib/armazenamentoObjetos.ts lá), pedido explícito da
// Luana ao pedir o upload do PDF da nota fiscal: mesmo padrão de
// storage, não um segundo módulo. Este arquivo é genérico (não sabe o
// que é uma "nota fiscal" nem um "convênio") — quem chama decide a
// chave/conteúdo; aqui só fica a integração com o bucket em si. Vendor:
// Railway Buckets (S3-compatível, nativo do Railway — sem precisar
// contratar S3/R2 à parte).
//
// RAILWAY BUCKETS é um bucket S3-compatível PRIVADO — não existe bucket
// público no Railway hoje. Toda leitura de um objeto precisa de uma
// leitura passa pelo servidor (`abrirLeituraArquivo`, em streaming), nunca
// uma URL direta do bucket.
//
// As env vars que o Railway injeta ao linkar um bucket a um serviço têm
// nomes genéricos (`BUCKET`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`,
// `REGION`, `ENDPOINT`) — prefixadas aqui como `RAILWAY_BUCKET_*` (ver
// .env.example) pra não colidir/confundir com outras env vars do
// projeto. `RAILWAY_BUCKET_REGION` cai pro valor `"auto"` (o que o
// Railway usa) quando ausente; `RAILWAY_BUCKET_FORCE_PATH_STYLE` cai pro
// valor `false` quando ausente (ver comentário em `criarClient` abaixo);
// as outras 4 não têm fallback possível.
//
// REGRA DURA, mesmo contrato de robustez do módulo original em
// nexaigen-educa: todas as funções exportadas NUNCA lançam — qualquer
// falha (env vars ausentes, erro de rede, erro do S3, timeout) devolve
// um valor "vazio" (`false`/`null`) com um `console.warn` que NUNCA loga
// a secret key nem o buffer do arquivo. O timeout é configurado no
// próprio `S3Client` via `NodeHttpHandler` (ver `criarClient`) — o SDK
// da AWS v3 não aplica nenhum timeout de rede por padrão, então sem isso
// uma conexão travada (rede lenta, bucket com problema) deixaria
// `uploadArquivo`/`abrirLeituraArquivo` pendurados indefinidamente em vez
// de devolver `false`/`null` rapidamente.
//
// TESTABILIDADE: `lib/armazenamentoObjetos.test.ts` mocka o SDK da AWS
// via `vi.mock("@aws-sdk/client-s3", ...)`
// — nunca rede real, nunca uma conta Railway real. Quem CHAMA este
// módulo (lib/versionamentoPdf.ts, lib/recalcularHashVersoes.ts) mocka o
// módulo INTEIRO (testes/bucketEmMemoria.ts nos testes de integração) —
// não precisa conhecer o SDK.

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { alertarErroSistema } from "./alertaErroSistema";

// Timeout de rede do S3Client (ver criarClient abaixo). Upload de
// arquivo de até 10MB: 25s dá margem real pra isso completar numa
// conexão só razoável, sem deixar a requisição pendurada indefinidamente
// numa conexão travada de verdade. connectionTimeout (só estabelecer a
// conexão TCP) pode ser bem mais curto — se isso não fechar rápido, já é
// sinal de problema.
const TIMEOUT_CONEXAO_MS = 5_000;
const TIMEOUT_REQUISICAO_MS = 25_000;

interface ConfigBucket {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint: string;
  forcePathStyle: boolean;
}

/**
 * Lê as env vars RAILWAY_BUCKET_* — as 4 obrigatórias (nome, chaves,
 * endpoint) juntas antes de qualquer chamada ao SDK, ausência de
 * QUALQUER uma delas é tratada como "armazenamento não configurado"
 * (null), nunca uma exceção não tratada. `RAILWAY_BUCKET_FORCE_PATH_STYLE`
 * e `RAILWAY_BUCKET_REGION` são as duas únicas com fallback (ver
 * criarClient/interface acima).
 */
function lerConfigBucket(): ConfigBucket | null {
  const bucket = process.env.RAILWAY_BUCKET_NAME;
  const accessKeyId = process.env.RAILWAY_BUCKET_ACCESS_KEY_ID;
  const secretAccessKey = process.env.RAILWAY_BUCKET_SECRET_ACCESS_KEY;
  const endpoint = process.env.RAILWAY_BUCKET_ENDPOINT;
  const region = process.env.RAILWAY_BUCKET_REGION || "auto";
  const forcePathStyle = process.env.RAILWAY_BUCKET_FORCE_PATH_STYLE === "true";

  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) return null;
  return { bucket, accessKeyId, secretAccessKey, region, endpoint, forcePathStyle };
}

function criarClient(config: ConfigBucket): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Railway Buckets usa virtual-hosted-style por padrão hoje pra
    // buckets recém-criados (https://bucket.endpoint/chave — o mesmo
    // formato padrão de S3 de verdade, e também o default do SDK) —
    // NÃO path-style. Path-style (https://endpoint/bucket/chave) é a
    // exceção, só necessária pra buckets criados ANTES de uma mudança
    // específica do Railway (doc oficial:
    // https://docs.railway.com/storage-buckets, seção "URL style"). A
    // própria doc do Railway reconhece que não dá pra cravar isso sem
    // olhar as credenciais do bucket específico ("The Credentials tab
    // of your bucket will tell you which style you should use") — por
    // isso é configurável via RAILWAY_BUCKET_FORCE_PATH_STYLE em vez de
    // um valor fixo: default `false` (o comportamento documentado hoje
    // pra um bucket novo), setável pra `"true"` se a aba Credentials do
    // bucket real indicar path-style.
    forcePathStyle: config.forcePathStyle,
    // Ver constantes no topo do arquivo — o SDK da AWS v3 não aplica
    // nenhum timeout de rede por padrão (NodeHttpHandler's default é 0,
    // "sem timeout"). throwOnRequestTimeout é necessário pra um estouro
    // de requestTimeout virar de fato um erro lançado (e cair no catch
    // de uploadArquivo/abrirLeituraArquivo) — sem isso, o SDK só loga um
    // aviso e a chamada continua pendurada mesmo assim.
    requestHandler: new NodeHttpHandler({
      connectionTimeout: TIMEOUT_CONEXAO_MS,
      requestTimeout: TIMEOUT_REQUISICAO_MS,
      throwOnRequestTimeout: true
    })
  });
}

/**
 * Envia um arquivo pro bucket (PutObject). NUNCA lança — qualquer falha
 * devolve `false` com um aviso que nunca loga a secret key nem o
 * conteúdo do arquivo.
 */
export async function uploadArquivo(chave: string, buffer: Buffer, tipoMime: string): Promise<boolean> {
  const config = lerConfigBucket();
  if (!config) {
    console.warn(
      "Armazenamento de objetos: RAILWAY_BUCKET_NAME/RAILWAY_BUCKET_ACCESS_KEY_ID/RAILWAY_BUCKET_SECRET_ACCESS_KEY/RAILWAY_BUCKET_ENDPOINT não configurados por completo — upload não realizado."
    );
    await alertarErroSistema("railway_bucket", "Variáveis RAILWAY_BUCKET_* não configuradas por completo — upload não realizado.");
    return false;
  }

  try {
    const client = criarClient(config);
    await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: chave, Body: buffer, ContentType: tipoMime }));
    return true;
  } catch {
    // Nunca loga o erro cru nem qualquer parte da configuração.
    console.warn("Armazenamento de objetos: falha ao enviar arquivo pro bucket — upload não realizado.");
    await alertarErroSistema("railway_bucket", "Falha ao enviar arquivo pro bucket (upload) — ver logs do servidor para detalhe.");
    return false;
  }
}

export type LeituraArquivo =
  | { ok: true; corpo: ReadableStream<Uint8Array>; tamanhoBytes: number | null }
  | { ok: false; motivo: "ausente" | "indisponivel" };

/**
 * Abre a leitura de um objeto (GetObject) em STREAMING — o corpo é
 * repassado direto pra resposta HTTP (download do PDF) ou pro cálculo de
 * hash (scripts/recalcular-hash-versoes-pdf.ts), nunca carregado inteiro
 * em memória. Distingue "objeto não existe" (`ausente`, sem alerta de
 * sistema — é dado inconsistente, não bucket fora do ar) de qualquer outra
 * falha (`indisponivel`, com alerta "railway_bucket"). NUNCA lança.
 * O timeout de rede do S3Client (criarClient) vale pra abrir a leitura e
 * pra cada pausa da transferência.
 */
export async function abrirLeituraArquivo(chave: string): Promise<LeituraArquivo> {
  const config = lerConfigBucket();
  if (!config) {
    console.warn("Armazenamento de objetos: RAILWAY_BUCKET_* não configurados por completo — leitura não realizada.");
    await alertarErroSistema("railway_bucket", "Variáveis RAILWAY_BUCKET_* não configuradas por completo — leitura de arquivo não realizada.");
    return { ok: false, motivo: "indisponivel" };
  }

  try {
    const client = criarClient(config);
    const resposta = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: chave }));
    if (!resposta.Body) throw new Error("corpo vazio");
    return { ok: true, corpo: resposta.Body.transformToWebStream() as ReadableStream<Uint8Array>, tamanhoBytes: resposta.ContentLength ?? null };
  } catch (erro) {
    const e = erro as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
      console.warn("Armazenamento de objetos: objeto não encontrado no bucket.");
      return { ok: false, motivo: "ausente" };
    }
    console.warn("Armazenamento de objetos: falha ao abrir leitura do bucket.");
    await alertarErroSistema("railway_bucket", "Falha ao ler arquivo do bucket (download) — ver logs do servidor para detalhe.");
    return { ok: false, motivo: "indisponivel" };
  }
}

/**
 * Apaga um objeto (DeleteObject) — USO ÚNICO E RESTRITO: desfazer um
 * upload que ACABOU de ser feito quando a gravação correspondente no banco
 * falhou (sem isso o objeto ficaria órfão, sem nenhuma versão apontando
 * pra ele). Nunca usado pra apagar uma versão já registrada: histórico de
 * documento fiscal não se apaga (ver 0005_nota_fiscal_arquivo_versao.sql).
 * NUNCA lança — devolve false em qualquer falha, sem alertar: quem chama
 * decide o alerta, porque só ele sabe que sobrou um órfão.
 */
export async function removerUploadNaoRegistrado(chave: string): Promise<boolean> {
  const config = lerConfigBucket();
  if (!config) return false;
  try {
    const client = criarClient(config);
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: chave }));
    return true;
  } catch {
    console.warn("Armazenamento de objetos: falha ao remover objeto recém-enviado.");
    return false;
  }
}
