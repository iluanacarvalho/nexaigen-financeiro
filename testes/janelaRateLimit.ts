// Helper SÓ de teste (integração de rate limit). Os contadores usam janela
// FIXA (lib/rateLimit.ts): um teste que faz N tentativas e espera o 429 na
// N+1ª falharia de forma intermitente se começasse a poucos segundos da
// virada da janela (as últimas tentativas cairiam na janela nova, que
// recomeça do zero). Isto espera a virada quando faltam menos de
// `margemSegundos` pro fim da janela atual — o teste sempre começa com
// folga dentro de uma janela só. Usa o relógio do Postgres (o mesmo que
// lib/rateLimit.ts usa pra calcular a janela), nunca o do processo.

import { query } from "@/lib/db";

export async function aguardarLongeDaViradaDaJanela(janelaSegundos: number, margemSegundos: number): Promise<void> {
  const [{ restante }] = await query<{ restante: number }>(
    `select ($1::int - mod(extract(epoch from now())::numeric, $1::int))::float8 as restante`,
    [janelaSegundos]
  );
  if (restante < margemSegundos) await new Promise((resolver) => setTimeout(resolver, Math.ceil(restante * 1000) + 250));
}
