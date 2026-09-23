// Dispara o alerta de escalonamento para o time de cobrança.
//
// Canal único: e-mail transacional via Resend (substituiu o Slack, que era
// o único canal antes). Motivo da troca: e-mail chega a qualquer membro do
// time sem depender de estar com o Slack aberto, e a Resend dá
// rastreabilidade de entrega que o webhook do Slack não dava.
//
// Corpo em HTML (rodada de "e-mails bem lindos") via
// lib/emailTemplate.ts#montarEmailHtml — mesma identidade visual do
// nexaigen-educa (navy/teal). Antes disso o corpo era texto puro; a MESMA
// informação é preservada (tipo de alerta, cliente, NF, valor, dias de
// atraso), só reformatada como uma tabela simples — é uso interno, não
// precisa ser elaborado.
//
// REGRA DURA (mesmo contrato de robustez de lib/notificacaoCliente.ts):
// NUNCA lança. Achado ao revisar este arquivo pra esta rodada: a versão
// anterior não tinha try/catch nenhum ao redor de resend.emails.send() —
// uma falha de REDE (não um erro devolvido pela API, mas uma exceção
// lançada pelo próprio client) propagaria pra fora desta função e
// derrubaria o loop inteiro de app/api/cron/verificar-prazos, deixando
// notas seguintes sem processar. Corrigido aqui: timeout de 5s (o SDK do
// Resend não expõe AbortSignal, daí o Promise.race) e try/catch cobrindo
// a chamada de rede, não só a resposta de erro da API.

import { Resend } from "resend";
import { montarEmailHtml } from "./emailTemplate";

// clienteNome/numeroNf vêm de dado cadastrado (cliente_prefeitura.nome,
// nota_fiscal.numero) — hoje sempre digitado pela própria equipe da
// NEXAIGEN, mas interpolado direto em HTML sem escapar quebraria o
// layout (ou, no limite, injetaria marcação arbitrária) se algum dia
// contivesse "<"/">"/"&". Mesmo cuidado já aplicado no projeto irmão
// nexaigen-educa (lib/notificacao.ts/lib/alertaOperacional.ts#escaparHtml).
function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface AlertaParaNotificar {
  tipo: string;
  clienteNome: string;
  numeroNf: string | null;
  valor: number;
  diasDeAtraso: number | null;
}

const LABEL_TIPO: Record<string, string> = {
  sem_atesto_prolongado: "Sem atesto há muito tempo",
  proximo_vencimento: "Vencendo em breve",
  vencido: "Vencido",
  atraso_60_dias: "Atraso crítico (≥60 dias) — acionar cobrança"
};

const TIMEOUT_ALERTA_MS = 5000;

function comTimeout<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promessa,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

export async function notificarTimeDeCobranca(alerta: AlertaParaNotificar): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const destino = process.env.COBRANCA_EMAIL_DESTINO;
  const remetente = process.env.ALERTA_EMAIL_REMETENTE ?? "alertas@nexaigen.com.br";

  if (!apiKey || !destino) {
    console.warn(
      "RESEND_API_KEY ou COBRANCA_EMAIL_DESTINO não configurados — alerta gravado no banco, mas nenhuma notificação foi enviada."
    );
    return;
  }

  const rotulo = LABEL_TIPO[alerta.tipo] ?? alerta.tipo;
  const assunto = `[NEXAIGEN] ${rotulo} — ${alerta.clienteNome}`;
  const corpoHtml = `
    <p><strong>Alerta de cobrança:</strong> ${escaparHtml(rotulo)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:12px;">
      <tr>
        <td style="padding:6px 0;color:#6B7280;">Cliente</td>
        <td style="padding:6px 0;font-weight:bold;">${escaparHtml(alerta.clienteNome)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#6B7280;">NF</td>
        <td style="padding:6px 0;">${alerta.numeroNf ? escaparHtml(alerta.numeroNf) : "—"}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#6B7280;">Valor</td>
        <td style="padding:6px 0;">R$ ${alerta.valor.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#6B7280;">Dias de atraso</td>
        <td style="padding:6px 0;">${alerta.diasDeAtraso ?? "—"}</td>
      </tr>
    </table>
  `;
  const html = montarEmailHtml({ produto: "NEXAIGEN", corpoHtml });

  try {
    const resend = new Resend(apiKey);
    const { error } = await comTimeout(resend.emails.send({ from: remetente, to: destino, subject: assunto, html }), TIMEOUT_ALERTA_MS);

    if (error) {
      // Nunca loga o corpo completo do erro — só o nome do código,
      // suficiente pra triagem.
      console.error(`Falha ao enviar notificação via Resend — código: ${error.name}.`);
    }
  } catch (erro) {
    const motivo = erro instanceof Error && erro.message === "timeout" ? "timeout" : "erro de rede";
    console.error(`Falha ao enviar notificação via Resend — ${motivo}, alerta gravado no banco mas notificação não confirmada.`);
  }
}
