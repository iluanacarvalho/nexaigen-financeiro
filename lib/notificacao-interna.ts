// Dispara o alerta de escalonamento para o time de cobrança.
//
// Canal único: e-mail transacional via Resend (substituiu o Slack, que era
// o único canal antes). Motivo da troca: e-mail chega a qualquer membro do
// time sem depender de estar com o Slack aberto, e a Resend dá
// rastreabilidade de entrega que o webhook do Slack não dava. O corpo do
// e-mail é texto simples de propósito — sem depender de template/HTML para
// manter a lógica simples de auditar.

import { Resend } from "resend";

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
  const corpoTexto = [
    `Alerta de cobrança: ${rotulo}`,
    `Cliente: ${alerta.clienteNome}`,
    `NF: ${alerta.numeroNf ?? "—"}`,
    `Valor: R$ ${alerta.valor.toFixed(2)}`,
    `Dias de atraso: ${alerta.diasDeAtraso ?? "—"}`
  ].join("\n");

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: remetente,
    to: destino,
    subject: assunto,
    text: corpoTexto
  });

  if (error) {
    console.error("Falha ao enviar notificação via Resend:", error);
  }
}
