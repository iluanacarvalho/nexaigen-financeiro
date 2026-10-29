// O que está (ou não) configurado no ambiente — APENAS booleanos, nunca
// valores. Usado por GET /api/configuracao/status e pelo aviso do
// Dashboard (app/(protegido)/page.tsx), pra quem opera a plataforma saber
// o que vai deixar de funcionar ANTES de descobrir pela falta de um e-mail.
//
// Nada aqui devolve, loga ou concatena o valor de uma variável: só
// `estaDefinida()` olha o conteúdo, e só pra decidir sim/não (vazio ou só
// espaços conta como ausente). Provado em lib/statusConfiguracao.test.ts e
// app/api/configuracao/status/route.test.ts com valores-sentinela.

export interface StatusConfiguracao {
  /** Chave da API do Resend — sem ela nenhum e-mail sai (cobrança, cliente, alerta de sistema). */
  resendApiKey: boolean;
  /** Remetente dos e-mails (ALERTA_EMAIL_REMETENTE). Ausente → usa o padrão alertas@nexaigen.com.br. */
  remetenteEmail: boolean;
  /** Destino dos alertas de falha de sistema. */
  alertaSistemaDestino: boolean;
  /** Destino do time de cobrança (alerta de 60 dias e cópia oculta dos e-mails ao cliente). */
  cobrancaDestino: boolean;
  /** As 4 variáveis obrigatórias do bucket (RAILWAY_BUCKET_NAME/ACCESS_KEY_ID/SECRET_ACCESS_KEY/ENDPOINT) juntas. */
  bucketCompleto: boolean;
  /** Segredo do job diário. Ausente OU ainda com o texto de exemplo do .env.example conta como não configurado. */
  cronSecret: boolean;
  /** Segredo da integração com o nexaigen-educa. */
  integracaoSecret: boolean;
  /** Segredo de assinatura do login. */
  jwtSecret: boolean;
}

export const VARIAVEIS_BUCKET = [
  "RAILWAY_BUCKET_NAME",
  "RAILWAY_BUCKET_ACCESS_KEY_ID",
  "RAILWAY_BUCKET_SECRET_ACCESS_KEY",
  "RAILWAY_BUCKET_ENDPOINT"
] as const;

// Texto literal do .env.example — público, então comparar com ele não
// revela nada; deixar esse texto em produção equivale a não ter segredo.
const EXEMPLO_CRON_SECRET = "troque-por-um-valor-aleatorio-longo";

type Ambiente = Record<string, string | undefined>;

function estaDefinida(ambiente: Ambiente, nome: string): boolean {
  return (ambiente[nome] ?? "").trim().length > 0;
}

export function lerStatusConfiguracao(ambiente: Ambiente = process.env): StatusConfiguracao {
  return {
    resendApiKey: estaDefinida(ambiente, "RESEND_API_KEY"),
    remetenteEmail: estaDefinida(ambiente, "ALERTA_EMAIL_REMETENTE"),
    alertaSistemaDestino: estaDefinida(ambiente, "ALERTA_SISTEMA_EMAILS_DESTINO"),
    cobrancaDestino: estaDefinida(ambiente, "COBRANCA_EMAIL_DESTINO"),
    bucketCompleto: VARIAVEIS_BUCKET.every((nome) => estaDefinida(ambiente, nome)),
    cronSecret: estaDefinida(ambiente, "CRON_SECRET") && ambiente.CRON_SECRET!.trim() !== EXEMPLO_CRON_SECRET,
    integracaoSecret: estaDefinida(ambiente, "INTEGRACAO_SECRET"),
    jwtSecret: estaDefinida(ambiente, "JWT_SECRET")
  };
}

/**
 * Avisos em linguagem simples, um por funcionalidade afetada (nunca um por
 * variável solta) — o que o Dashboard mostra. Lista vazia = tudo certo.
 */
export function avisosDeConfiguracao(status: StatusConfiguracao): string[] {
  const avisos: string[] = [];

  if (!status.resendApiKey) {
    avisos.push("E-mails não serão enviados (cobrança, aviso à prefeitura e alerta de falha): falta a chave do Resend (RESEND_API_KEY).");
  } else {
    const faltam: string[] = [];
    if (!status.cobrancaDestino) faltam.push("e-mail do time de cobrança (COBRANCA_EMAIL_DESTINO)");
    if (!status.alertaSistemaDestino) faltam.push("e-mail de quem recebe alertas de falha (ALERTA_SISTEMA_EMAILS_DESTINO)");
    if (faltam.length > 0) avisos.push(`Alguns e-mails internos não serão enviados: falta ${faltam.join(" e ")}.`);
    if (!status.remetenteEmail) {
      avisos.push("Remetente dos e-mails não definido (ALERTA_EMAIL_REMETENTE): será usado alertas@nexaigen.com.br — confirme que esse domínio está verificado no Resend.");
    }
  }
  if (!status.bucketCompleto) {
    avisos.push("PDFs (nota fiscal e contrato) não poderão ser anexados nem baixados: a configuração do armazenamento (RAILWAY_BUCKET_*) está incompleta.");
  }
  if (!status.cronSecret) {
    avisos.push("O job diário de prazos e cobrança será recusado: falta definir CRON_SECRET (ou ainda está com o texto de exemplo).");
  }
  if (!status.integracaoSecret) {
    avisos.push("Prefeituras cadastradas no Educa não chegarão aqui automaticamente: falta INTEGRACAO_SECRET.");
  }
  if (!status.jwtSecret) {
    avisos.push("O login não funcionará: falta JWT_SECRET.");
  }
  return avisos;
}
