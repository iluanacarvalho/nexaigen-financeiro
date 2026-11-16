// Barreira ÚNICA das rotas chamadas pelo nexaigen-educa (rodada 12-A —
// antes vivia dentro de app/api/integracao/clientes/route.ts; agora a rota
// de cancelamento usa a mesma, sem cópia):
//   1. rate limit por IP (60/min no total) — lib/rateLimit.ts;
//   2. INTEGRACAO_SECRET ausente → 401 + alerta de sistema (toda chamada do
//      Educa estaria sendo recusada);
//   3. 10 falhas de autenticação por IP em 15 min → 429 mesmo com o segredo
//      certo (a tentativa soma ANTES de comparar e é devolvida se confere —
//      só falha acumula);
//   4. `Authorization: Bearer <INTEGRACAO_SECRET>` comparado em tempo
//      constante (lib/segredoCompartilhado.ts). Segredo errado → o mesmo
//      401 genérico, SEM alerta (é a barreira funcionando; alertar daria a
//      qualquer um um jeito de disparar e-mail).
// Nunca sessão de equipe — app/api/protecao-rotas.test.ts confere.

import { NextResponse } from "next/server";
import { alertarErroSistema } from "./alertaErroSistema";
import { bearerConfere } from "./segredoCompartilhado";
import {
  LIMITE_INTEGRACAO_FALHA_AUTH,
  LIMITE_INTEGRACAO_POR_IP,
  desfazerTentativa,
  obterIpCliente,
  registrarTentativa,
  respostaLimiteExcedido
} from "./rateLimit";

export const CATEGORIA_ALERTA_INTEGRACAO = "integracao_educa";

/** null = autorizado; senão, a resposta (401/429) a devolver como está. */
export async function autorizarIntegracao(req: Request): Promise<Response | null> {
  const ip = obterIpCliente(req);
  const porIp = await registrarTentativa(LIMITE_INTEGRACAO_POR_IP, ip);
  if (!porIp.permitido) return respostaLimiteExcedido(porIp.retryAfterSegundos);

  if (!process.env.INTEGRACAO_SECRET) {
    console.error("INTEGRACAO_SECRET não configurado — recusando chamada de integração do Educa.");
    await alertarErroSistema(
      CATEGORIA_ALERTA_INTEGRACAO,
      "INTEGRACAO_SECRET não configurado — toda chamada de integração do nexaigen-educa está sendo recusada (clientes novos não chegam ao Financeiro)."
    );
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const tentativaAuth = await registrarTentativa(LIMITE_INTEGRACAO_FALHA_AUTH, ip);
  if (!tentativaAuth.permitido) return respostaLimiteExcedido(tentativaAuth.retryAfterSegundos);
  if (!bearerConfere(req.headers.get("authorization"), process.env.INTEGRACAO_SECRET)) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  await desfazerTentativa(LIMITE_INTEGRACAO_FALHA_AUTH, ip);
  return null;
}
