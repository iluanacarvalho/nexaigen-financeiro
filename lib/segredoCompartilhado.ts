// Autenticação por segredo compartilhado (`Authorization: Bearer <segredo>`)
// das duas rotas chamadas por OUTRO SISTEMA, não por uma pessoa logada:
// o job diário (app/api/cron/verificar-prazos, CRON_SECRET) e a
// integração com o nexaigen-educa (app/api/integracao/clientes,
// INTEGRACAO_SECRET). Antes desta rodada cada rota tinha uma cópia da
// mesma função; agora as duas mudaram juntas (comparação por digest), por
// isso viraram um módulo só.
//
// TEMPO CONSTANTE: compara os sha256 dos dois valores com
// crypto.timingSafeEqual. Os digests têm sempre 32 bytes — então nunca há
// o caso de "tamanhos diferentes" (que faz timingSafeEqual lançar) e o
// tempo da comparação não depende nem do conteúdo nem do TAMANHO do
// segredo esperado (comparar os valores crus exigiria um early-return
// quando os tamanhos diferem, o que já vaza o tamanho do segredo).

import { createHash, timingSafeEqual } from "node:crypto";

function digest(valor: string): Buffer {
  return createHash("sha256").update(valor, "utf8").digest();
}

/**
 * true só se `header` for exatamente `Bearer <segredo>`. Segredo vazio
 * nunca autentica (quem chama já trata "não configurado" antes, mas isto
 * garante que um segredo em branco jamais vire "qualquer `Bearer ` passa").
 */
export function bearerConfere(header: string | null, segredo: string): boolean {
  if (!header || !segredo) return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${segredo}`));
}
