// E-mail automático PARA A PREFEITURA CLIENTE (não pro time interno da
// NEXAIGEN — ver lib/notificacao-interna.ts pra esse) quando o job diário
// (app/api/cron/verificar-prazos) processa uma nota num dos 4 estágios de
// lib/tipos.ts#TipoAlerta.
//
// DECISÃO DE PRODUTO (Luana, explícita): o disparo é automático, não um
// template manual — mas o TOM é a parte sensível deste recurso. Uma
// prefeitura é um cliente institucional da própria NEXAIGEN, não um
// devedor comum — uma frase automática do tipo "vamos protestar"/"vamos
// acionar"/"medidas legais" pode gerar um problema desproporcional ao
// objetivo real (lembrar/pedir uma ação simples). Por isso:
//   - NENHUM dos 4 textos abaixo contém qualquer afirmação de natureza
//     jurídica ou ameaça, mesmo no estágio mais avançado (atraso_60_dias).
//   - O tom escala de "neutro/prestativo" (sem_atesto_prolongado) até
//     "mais sério, mas ainda convidando ao diálogo" (atraso_60_dias) —
//     nunca chega a "cobrança agressiva".
//   - Se a escala de tom precisar mudar no futuro, mude aqui
//     (montarConteudo abaixo) primeiro — é o único lugar que decide a
//     redação enviada em nome da empresa pra um cliente externo.
//
// DECISÃO DE DESIGN — disparo só NA TRANSIÇÃO de estado, nunca todo dia
// enquanto o estado persistir (recomendação da própria Luana: mandar o
// mesmo aviso todo dia pra uma prefeitura tende a ser ruim pra relação
// com o cliente). NENHUMA coluna nova de controle
// (`ultimo_alerta_cliente_enviado` ou similar) foi criada pra isso — o
// mecanismo que já existe em supabase/schema.sql já resolve isso de
// graça: `alerta_cobranca` tem um índice único parcial
// (`uq_alerta_ativo`, nota_fiscal_id+tipo, where status <> 'resolvido'),
// e app/api/cron/verificar-prazos já faz upsert com `ignoreDuplicates:
// true` nessa tabela. Isso significa que o upsert só retorna uma linha
// quando ela foi REALMENTE inserida agora (primeira vez que aquele tipo
// de alerta aparece pra aquela nota, ou reaparece depois de já ter sido
// resolvido) — rodar o job duas vezes no mesmo dia (ou todo dia
// seguinte, enquanto a nota continuar no mesmo estágio) faz o upsert
// ignorar silenciosamente a segunda tentativa, sem inserir linha nova.
// app/api/cron/verificar-prazos já usava exatamente esse sinal (upsert
// retornou linha vs. não retornou) pra decidir quando chamar
// notificarTimeDeCobranca (só no tipo atraso_60_dias, historicamente) —
// esta rodada só estende a MESMA checagem, já existente, pra também
// chamar notificarClientePrefeitura nos 4 tipos. Ver o comentário no
// próprio route.ts. Reaproveitar esse sinal em vez de inventar uma coluna
// nova evita duas fontes de verdade que poderiam divergir (ex.: alerta
// marcado "resolvido" manualmente mas a coluna de controle não
// resetada).
//
// BCC obrigatório: TODO e-mail que sai em nome da empresa para o cliente
// vai também, em cópia oculta (nunca CC visível pro cliente — a
// prefeitura não precisa ver o endereço interno de cobrança), pro e-mail
// interno de cobrança (COBRANCA_EMAIL_DESTINO) — visibilidade total do
// que está sendo mandado automaticamente, sem exceção, mesmo quando o
// próprio time de cobrança não foi notificado separadamente (só
// atraso_60_dias aciona notificarTimeDeCobranca; os outros 3 tipos só
// aparecem pro time via este BCC).
//
// MESMO CONTRATO DE ROBUSTEZ de lib/notificacao-interna.ts: NUNCA lança.
// Falha (RESEND_API_KEY ausente, contato_email ausente/vazio, erro da
// API do Resend, timeout, erro de rede) só produz um console.warn — o
// alerta em si já foi gravado com sucesso em alerta_cobranca antes deste
// ponto (ver route.ts), e o envio é best-effort sobre ele.

import { Resend } from "resend";
import { montarEmailHtml } from "./emailTemplate";
import type { TipoAlerta } from "./tipos";

// clienteNome/numeroNf vêm de dado cadastrado (cliente_prefeitura.nome,
// nota_fiscal.numero) — este e-mail sai em nome da empresa direto pra
// CLIENTE EXTERNO (a prefeitura), então o mesmo cuidado do projeto irmão
// nexaigen-educa se aplica aqui com ainda mais razão: interpolar sem
// escapar quebraria o layout (ou pior) se o nome/número contiver
// "<"/">"/"&".
function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface DadosNotificacaoCliente {
  tipo: TipoAlerta;
  clienteNome: string;
  contatoEmail: string | null;
  numeroNf: string | null;
  valor: number;
  // ISO (aaaa-mm-dd) — data_limite_pagamento da nota. Usada só nos
  // estágios que mencionam data (proximo_vencimento/vencido/atraso_60_dias);
  // sem_atesto_prolongado não tem vencimento ainda (a nota nem foi
  // atestada), então este campo é irrelevante nesse estágio.
  dataVencimento: string | null;
}

const TIMEOUT_EMAIL_MS = 5000;

function comTimeout<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promessa,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

function formatarMoeda(valor: number): string {
  return valor.toFixed(2);
}

function formatarDataBr(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

// E-mail de contato citado no corpo dos 4 estágios (pedido explícito da
// Luana, revisando o texto) — dá um canal concreto pra prefeitura
// responder, em vez de um "estamos à disposição" vago sem endereço
// nenhum. Mesmo endereço já usado como COBRANCA_EMAIL_DESTINO (BCC) por
// padrão — mas como uma STRING fixa aqui, não lida de env var: mudar o
// e-mail de BCC (ex.: uma conta de monitoramento) não deve mudar
// silenciosamente o e-mail que o CLIENTE vê e usa pra responder.
const EMAIL_CONTATO = "financeiro@nexaigen.com.br";

interface ConteudoEstagio {
  assunto: string;
  corpoHtml: string;
}

// Redação por estágio — ver o comentário de topo do arquivo sobre por que
// o tom escala sem NUNCA virar ameaça/afirmação jurídica. `numeroNf`
// ausente vira "—" (mesma convenção de lib/notificacao-interna.ts);
// `dataVencimento` ausente também, embora isso não deveria acontecer na
// prática pros 3 estágios que a exigem (a nota só chega a esses estágios
// depois de atestada, momento em que data_limite_pagamento já foi
// calculada pelo trigger do banco).
function montarConteudo(dados: DadosNotificacaoCliente): ConteudoEstagio {
  const numeroNf = escaparHtml(dados.numeroNf ?? "—");
  const valor = formatarMoeda(dados.valor);
  const dataVencimento = dados.dataVencimento ? formatarDataBr(dados.dataVencimento) : "—";

  switch (dados.tipo) {
    case "sem_atesto_prolongado":
      return {
        assunto: `Nota fiscal aguardando atesto — ${dados.clienteNome}`,
        corpoHtml: `
          <p>Olá!</p>
          <p>A nota fiscal nº <strong>${numeroNf}</strong>, no valor de R$ ${valor}, está aguardando o atesto de recebimento há alguns dias. Assim que possível, pedimos a gentileza de verificar e confirmar o atesto junto ao setor responsável, para que o pagamento possa seguir o fluxo normal.</p>
          <p>Qualquer dúvida, estamos à disposição em <a href="mailto:${EMAIL_CONTATO}">${EMAIL_CONTATO}</a>.</p>
        `
      };
    case "proximo_vencimento":
      return {
        assunto: `Lembrete: vencimento próximo — NF ${numeroNf}`,
        corpoHtml: `
          <p>Olá!</p>
          <p>Passando para lembrar que a nota fiscal nº <strong>${numeroNf}</strong>, no valor de R$ ${valor}, vence em breve, no dia <strong>${dataVencimento}</strong>.</p>
          <p>Qualquer dúvida sobre o processo, estamos à disposição em <a href="mailto:${EMAIL_CONTATO}">${EMAIL_CONTATO}</a>.</p>
        `
      };
    case "vencido":
      return {
        assunto: `Nota fiscal vencida — NF ${numeroNf}`,
        corpoHtml: `
          <p>Olá!</p>
          <p>A nota fiscal nº <strong>${numeroNf}</strong>, no valor de R$ ${valor}, venceu em <strong>${dataVencimento}</strong> e consta em aberto até o momento. Pedimos a gentileza de verificar a situação do pagamento junto ao setor financeiro.</p>
          <p>Qualquer dúvida ou pendência de nossa parte, estamos à disposição para esclarecer em <a href="mailto:${EMAIL_CONTATO}">${EMAIL_CONTATO}</a>.</p>
        `
      };
    case "atraso_60_dias":
      return {
        assunto: `Nota fiscal em atraso há mais de 60 dias — NF ${numeroNf}`,
        corpoHtml: `
          <p>Olá!</p>
          <p>A nota fiscal nº <strong>${numeroNf}</strong>, no valor de R$ ${valor}, está em aberto há mais de 60 dias, com vencimento em <strong>${dataVencimento}</strong>. Gostaríamos de entender se há alguma pendência de nossa parte ou do processo interno que esteja impedindo o pagamento — ficamos à disposição para conversar e resolver o quanto antes em <a href="mailto:${EMAIL_CONTATO}">${EMAIL_CONTATO}</a>.</p>
        `
      };
  }
}

/**
 * Envia o e-mail de lembrete pro contato da prefeitura cliente, com BCC
 * pro e-mail interno de cobrança (ver comentário de topo do arquivo).
 * NUNCA lança — devolve `false` em qualquer falha, com um console.warn
 * explicando o motivo, sem nunca logar a API key nem o corpo completo de
 * um eventual erro da Resend.
 */
export async function notificarClientePrefeitura(dados: DadosNotificacaoCliente): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const remetente = process.env.ALERTA_EMAIL_REMETENTE ?? "alertas@nexaigen.com.br";
  const bcc = process.env.COBRANCA_EMAIL_DESTINO;

  if (!apiKey) {
    console.warn("RESEND_API_KEY não configurada — e-mail ao cliente não enviado.");
    return false;
  }

  if (!dados.contatoEmail) {
    console.warn(`cliente_prefeitura sem contato_email configurado (${dados.clienteNome}) — e-mail ao cliente não enviado.`);
    return false;
  }

  const conteudo = montarConteudo(dados);
  // rodape (pedido explícito da Luana): TODO e-mail de alerta do
  // financeiro — interno ou pro cliente — leva o e-mail de contato no
  // rodapé, não só na frase de fechamento do corpo (ver montarConteudo
  // acima, que já cita EMAIL_CONTATO no texto pros 4 estágios).
  const html = montarEmailHtml({ produto: "NEXAIGEN", corpoHtml: conteudo.corpoHtml, rodape: EMAIL_CONTATO });

  try {
    const resend = new Resend(apiKey);
    const { error } = await comTimeout(
      resend.emails.send({
        from: remetente,
        to: dados.contatoEmail,
        // BCC obrigatório pro time interno de cobrança, sem exceção — ver
        // comentário de topo do arquivo. Omitido só se COBRANCA_EMAIL_DESTINO
        // não estiver configurada (mesma postura "opcional em runtime" já
        // usada por lib/notificacao-interna.ts — a ausência dela não pode
        // bloquear o e-mail ao cliente em si).
        ...(bcc ? { bcc } : {}),
        subject: conteudo.assunto,
        html
      }),
      TIMEOUT_EMAIL_MS
    );

    if (error) {
      console.warn(`Falha ao enviar e-mail ao cliente (${dados.clienteNome}) via Resend — código: ${error.name}.`);
      return false;
    }

    return true;
  } catch (erro) {
    const motivo = erro instanceof Error && erro.message === "timeout" ? "timeout" : "erro de rede";
    console.warn(`Falha ao enviar e-mail ao cliente (${dados.clienteNome}) via Resend — ${motivo}.`);
    return false;
  }
}
