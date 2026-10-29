// Roda nas DUAS suítes (unitária e integração — ver setupFiles em
// vitest.config.ts e vitest.integration.config.ts) antes de qualquer
// teste: garantia estrutural de que NENHUM teste fala de verdade com
// Resend ou com o Railway Buckets, mesmo que o .env.local carregado
// (vitest.integration.config.ts carrega .env.local/.env) tenha
// credenciais reais. Mesmo desenho do vitest.setup.sem-apis-externas.ts do
// projeto irmão nexaigen-educa.
//
// Camada 1 — zera as credenciais. Os módulos que falam com esses
// provedores (lib/notificacao-interna.ts, lib/notificacaoCliente.ts,
// lib/alertaErroSistema.ts, lib/armazenamentoObjetos.ts) já tratam
// "credencial ausente" como "não configurado, não tenta" — então sem
// credencial nenhum deles chega a abrir conexão. É a única camada que
// cobre o SDK da AWS (ele usa o módulo http do Node, não fetch).
//
// Camada 2 — guarda no fetch() global: qualquer fetch pra host que não
// seja localhost lança com mensagem clara. Cobre o SDK do Resend (usa
// fetch) caso algum teste redefina a chave e esqueça de mockar o SDK.
//
// Teste que PRECISA simular a chamada continua livre pra mockar
// (vi.mock("resend"), vi.mock do SDK da AWS, vi.stubGlobal("fetch")) — o
// mock substitui a chamada inteira e nunca passa por esta guarda. Prova
// de que as duas camadas funcionam: vitest.setup.sem-apis-externas.test.ts.

export const CREDENCIAIS_PROVEDOR_EXTERNO = [
  "RESEND_API_KEY",
  "RAILWAY_BUCKET_NAME",
  "RAILWAY_BUCKET_ACCESS_KEY_ID",
  "RAILWAY_BUCKET_SECRET_ACCESS_KEY",
  "RAILWAY_BUCKET_ENDPOINT"
];

for (const chave of CREDENCIAIS_PROVEDOR_EXTERNO) {
  delete process.env[chave];
}

// Destinos/remetente de e-mail: forçados pra endereços inofensivos (nunca
// o endereço real do .env.local) — defesa redundante caso um teste monte
// um client do Resend mockado e leia estes valores pro payload.
process.env.ALERTA_SISTEMA_EMAILS_DESTINO = "alerta-sistema-teste@example.invalid";
process.env.COBRANCA_EMAIL_DESTINO = "cobranca-teste@example.invalid";
process.env.ALERTA_EMAIL_REMETENTE = "remetente-teste@example.invalid";

const HOSTS_PERMITIDOS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function extrairUrl(entrada: Parameters<typeof fetch>[0]): string {
  if (typeof entrada === "string") return entrada;
  if (entrada instanceof URL) return entrada.toString();
  return entrada.url;
}

if (typeof globalThis.fetch === "function") {
  const fetchOriginal = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = extrairUrl(entrada);
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      host = "localhost"; // URL relativa — nunca é uma chamada de rede real no Node
    }
    if (!HOSTS_PERMITIDOS.has(host)) {
      throw new Error(
        `[guarda-apis-externas] Teste tentou chamar fetch() pra um host externo ("${host}") — proibido em todo teste deste projeto. ` +
          `Mocke a chamada (vi.mock no módulo/SDK, ou vi.stubGlobal("fetch", ...)). URL: ${url}`
      );
    }
    return fetchOriginal(entrada, init);
  }) as typeof fetch;
}
