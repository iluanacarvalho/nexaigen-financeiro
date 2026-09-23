// Wrapper visual compartilhado pra todo e-mail transacional/operacional
// enviado pela NEXAIGEN — identidade visual reaproveitada do painel
// administrativo do nexaigen-educa (navy #1F3864 primário, teal #2E75B6
// de destaque), não uma paleta nova inventada pra e-mail. Mesma empresa,
// mesma identidade, dois produtos — este arquivo é intencionalmente uma
// cópia estrutural de nexaigen-educa/lib/emailTemplate.ts, só o produto
// muda (aqui, sempre "NEXAIGEN", uso interno da empresa — nunca precisa
// dizer "Financeiro" pro cliente externo, ver lib/notificacaoCliente.ts).
//
// Layout em TABELA com CSS inline, de propósito — clientes de e-mail
// (Gmail, Outlook, Apple Mail) não confiam em <style> nem em
// flexbox/grid de forma consistente entre si; tabela + inline é o único
// jeito de garantir a mesma renderização nos três. Função pura, sem I/O,
// só string in/string out — quem monta o `corpoHtml` de cada e-mail
// específico (lib/notificacao-interna.ts, lib/notificacaoCliente.ts)
// decide o conteúdo; este módulo só decide a moldura.
export interface OpcoesEmailHtml {
  produto: string;
  corpoHtml: string;
  rodape?: string;
}

export function montarEmailHtml(opts: OpcoesEmailHtml): string {
  const rodapeTexto = opts.rodape ? `NEXAIGEN — ${opts.rodape}` : "NEXAIGEN";

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background-color:#F2F4F7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F2F4F7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background-color:#1F3864;padding:20px 32px;">
                <span style="color:#FFFFFF;font-size:18px;font-weight:bold;letter-spacing:0.5px;">${opts.produto}</span>
              </td>
            </tr>
            <tr>
              <td style="height:4px;background-color:#2E75B6;line-height:4px;font-size:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:32px;color:#1A1F36;font-size:14px;line-height:1.6;">
                ${opts.corpoHtml}
              </td>
            </tr>
            <tr>
              <td style="background-color:#F7F9FC;padding:16px 32px;border-top:1px solid #E5E9F0;">
                <span style="color:#8A94A6;font-size:12px;">${rodapeTexto}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
