// Peças de validação compartilhadas pelas rotas (rodada 10-A — zod 4).
//
// CONTRATO DA API: toda resposta 400 de validação traz
// `detalhes: { formErrors: string[], fieldErrors: { [campo]: string[] } }`
// — o formato do antigo `ZodError#flatten()` do zod 3, do qual o frontend
// (app/(protegido)/notas lê `detalhes.fieldErrors`) e os testes dependem.
// No zod 4 `.flatten()` está obsoleto; `z.flattenError()` devolve
// exatamente a mesma forma, e esta função é o ÚNICO lugar que a monta —
// se uma versão futura do zod mudar o formato, a compatibilidade se ajusta
// aqui, nunca o contrato. (Os TEXTOS padrão das mensagens do zod mudaram
// da v3 pra v4 — "Required" virou "Invalid input: expected string,
// received undefined", etc.; a forma não. Mensagens próprias do projeto,
// passadas em `error`, continuam idênticas.)

import { z } from "zod";

export interface DetalhesValidacao {
  formErrors: string[];
  fieldErrors: Record<string, string[] | undefined>;
}

export function detalhesDoErro(erro: z.ZodError): DetalhesValidacao {
  const { formErrors, fieldErrors } = z.flattenError(erro);
  return { formErrors, fieldErrors: fieldErrors as Record<string, string[] | undefined> };
}

/**
 * Id de rota (`[id]`) — uuid RFC 9562/4122 (z.uuid() do zod 4: versão e
 * bits de variante conferidos). Todo id do sistema nasce de
 * gen_random_uuid() do Postgres ou crypto.randomUUID() (v4, variante RFC),
 * e o município do Educa também (gen_random_uuid() lá) — nenhum id legítimo
 * fica de fora. Id que não é uuid vira 404 antes de chegar no banco (o
 * Postgres lançaria 22P02 num `where id = $1` com texto qualquer).
 */
export function ehUuid(valor: string): boolean {
  return z.uuid().safeParse(valor).success;
}
