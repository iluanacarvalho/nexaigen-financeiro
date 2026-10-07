// Alerta por e-mail pra FALHA TÉCNICA de sistema — categoria diferente de
// lib/notificacao-interna.ts (alerta de cobrança) e
// lib/notificacaoCliente.ts (e-mail pro contato da prefeitura), que são
// alertas de NEGÓCIO. Este módulo é genérico: não sabe o que é uma "nota
// fiscal" nem um "cliente", só recebe uma categoria (de onde veio a
// falha) e uma mensagem (o que aconteceu), igual lib/armazenamentoObjetos.ts
// é genérico em relação a "nota fiscal"/"convênio".
//
// Chamado a partir de pontos de falha técnica espalhados pelo código:
// lib/armazenamentoObjetos.ts (categoria "railway_bucket"),
// lib/notificacao-interna.ts/lib/notificacaoCliente.ts quando a PRÓPRIA
// Resend falha (categorias "resend_interno"/"resend_cliente"), o job de
// cron quando CRON_SECRET está ausente (categoria "job_verificar_prazos"),
// e instrumentation.ts#onRequestError pra qualquer exceção não tratada
// que chegue ao servidor (categoria "excecao_nao_tratada"). NUNCA chamado
// pra dado cadastral faltando de um cliente específico (ex.:
// cliente_prefeitura.contato_email ausente) — isso é qualidade de
// cadastro, não falha de sistema.
//
// DEBOUNCE de 30 minutos POR CATEGORIA — persistido em Postgres
// (log_alerta_sistema), não em memória: um cache em memória não
// sobreviveria entre instâncias/invocações diferentes de um deploy
// serverless, e silenciosamente deixaria de debounçar nada assim que a
// próxima requisição caísse numa instância diferente. A categoria agrupa
// falhas da MESMA origem — sem isso, uma falha persistente (ex.: bucket
// fora do ar por horas) inundaria a caixa de entrada com um e-mail por
// tentativa, em vez de um a cada 30 minutos.
//
// ATOMICIDADE DO DEBOUNCE: um único `insert ... where not exists (...)`
// decide atomicamente "essa categoria já alertou nos últimos 30min?" e
// grava a tentativa na MESMA instrução — nunca um SELECT seguido de um
// INSERT separado, que teria uma janela de corrida entre os dois. Isso
// não é uma garantia de serializabilidade total sob concorrência pesada
// (duas transações distintas podem, em teoria, passar pelo NOT EXISTS
// antes de qualquer uma commitar) — aceitável aqui pelo mesmo motivo que
// lib/notificacao-interna.ts/lib/notificacaoCliente.ts não têm proteção
// de concorrência nenhuma: volume baixo, uso interno, um e-mail
// duplicado ocasional sob uma corrida rara não é um problema real pra
// este caso de uso (diferente, por exemplo, do rate limiter de login do
// projeto irmão nexaigen-educa, que protege contra força bruta e por
// isso usa um advisory lock).
//
// MESMO CONTRATO DE ROBUSTEZ dos dois módulos irmãos (NUNCA lança) —
// estendido aqui pra cobrir inclusive uma falha do PRÓPRIO Postgres (um
// Postgres fora do ar é, ele mesmo, um motivo plausível de uma falha de
// sistema em primeiro lugar): todo o corpo da função roda dentro de um
// único try/catch — este módulo é um canal de alerta de ÚLTIMA instância,
// nunca pode derrubar quem o chamou.

import { Resend } from "resend";
import { query } from "./db";
import { montarEmailHtml } from "./emailTemplate";

const JANELA_DEBOUNCE_MINUTOS = 30;
const TIMEOUT_ALERTA_MS = 5000;

// mensagem (texto livre, pode incluir dado vindo de erro/stack) interpolada
// direto em HTML sem escapar quebraria o layout (ou pior) se contiver
// "<"/">"/"&" — mesmo cuidado já aplicado nos dois módulos irmãos.
function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function comTimeout<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promessa,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

/**
 * Múltiplos destinatários via vírgula — mesmo tratamento dado a
 * COBRANCA_EMAIL_DESTINO em lib/notificacao-interna.ts/lib/notificacaoCliente.ts.
 * Duplicada aqui (não importada de outro arquivo) de propósito — mesmo
 * padrão já usado por escaparHtml/comTimeout entre os três módulos:
 * são módulos independentes, cada um pode evoluir sem acoplar aos outros.
 */
function dividirEmails(valor: string): string[] {
  return valor
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * Decide atomicamente se `categoria` já alertou dentro da janela de
 * debounce — se não, registra a tentativa agora (devolve true, "pode
 * enviar"); se já alertou, não grava nada novo (devolve false,
 * "debounçado"). `make_interval` em vez de interpolar
 * JANELA_DEBOUNCE_MINUTOS na string SQL — mesmo princípio de "nunca
 * interpolar valores na string" já documentado em lib/db.ts, mesmo sendo
 * uma constante da própria aplicação, não dado externo.
 */
async function registrarSeNaoDebounced(categoria: string, mensagem: string): Promise<boolean> {
  const linhas = await query<{ id: string }>(
    `insert into log_alerta_sistema (categoria, mensagem)
     select $1, $2
     where not exists (
       select 1 from log_alerta_sistema
       where categoria = $1 and enviado_em > now() - make_interval(mins => $3)
     )
     returning id`,
    [categoria, mensagem, JANELA_DEBOUNCE_MINUTOS]
  );
  return linhas.length > 0;
}

/**
 * Alerta uma falha real de sistema por e-mail, com debounce de 30 minutos
 * por categoria. NUNCA lança — qualquer falha (Postgres indisponível,
 * RESEND_API_KEY/ALERTA_SISTEMA_EMAILS_DESTINO ausentes, erro da API do
 * Resend, timeout, erro de rede) só produz um console.warn/console.error,
 * nunca propaga pro chamador.
 */
export async function alertarErroSistema(categoria: string, mensagem: string): Promise<void> {
  try {
    const podeEnviar = await registrarSeNaoDebounced(categoria, mensagem);
    if (!podeEnviar) {
      console.warn(
        `[alerta-sistema] categoria "${categoria}" ainda dentro da janela de debounce de ${JANELA_DEBOUNCE_MINUTOS}min — e-mail não reenviado.`
      );
      return;
    }

    const apiKey = process.env.RESEND_API_KEY;
    const remetente = process.env.ALERTA_EMAIL_REMETENTE ?? "alertas@nexaigen.com.br";
    const destinoBruto = process.env.ALERTA_SISTEMA_EMAILS_DESTINO;

    if (!apiKey || !destinoBruto) {
      console.warn(
        `[alerta-sistema] RESEND_API_KEY ou ALERTA_SISTEMA_EMAILS_DESTINO não configurados — falha de sistema registrada no banco ("${categoria}"), mas nenhum e-mail foi enviado.`
      );
      return;
    }

    const destinatarios = dividirEmails(destinoBruto);
    if (destinatarios.length === 0) {
      console.warn(`[alerta-sistema] ALERTA_SISTEMA_EMAILS_DESTINO configurada mas vazia após parse — e-mail não enviado.`);
      return;
    }

    const assunto = `[NEXAIGEN] Falha de sistema — ${categoria}`;
    const corpoHtml = `
      <p><strong>Falha técnica detectada.</strong></p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:12px;">
        <tr>
          <td style="padding:6px 0;color:#6B7280;">Categoria</td>
          <td style="padding:6px 0;font-weight:bold;">${escaparHtml(categoria)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6B7280;">Detalhe</td>
          <td style="padding:6px 0;">${escaparHtml(mensagem)}</td>
        </tr>
      </table>
    `;
    const html = montarEmailHtml({ produto: "NEXAIGEN", corpoHtml });

    const resend = new Resend(apiKey);
    const { error } = await comTimeout(
      resend.emails.send({ from: remetente, to: destinatarios, subject: assunto, html }),
      TIMEOUT_ALERTA_MS
    );

    if (error) {
      // Nunca loga o corpo completo do erro — só o nome do código,
      // suficiente pra triagem, mesmo cuidado dos dois módulos irmãos.
      console.error(`[alerta-sistema] erro da API do Resend ao enviar alerta de "${categoria}" — código: ${error.name}.`);
    }
  } catch (erro) {
    // Nunca loga o erro cru (pode ecoar detalhe de configuração/conexão,
    // ex. um erro do pg) — mesmo cuidado dos dois módulos irmãos, só que
    // aplicado aqui a QUALQUER falha inesperada, não só rede/timeout do
    // Resend (o registrarSeNaoDebounced acima pode falhar por um motivo
    // totalmente diferente: o próprio Postgres indisponível).
    const motivo = erro instanceof Error && erro.message === "timeout" ? "timeout" : "erro inesperado";
    console.error(`[alerta-sistema] falha ao processar alerta de sistema ("${categoria}") — ${motivo}.`);
  }
}
