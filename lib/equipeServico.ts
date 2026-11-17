// Mudança de papel de uma pessoa da equipe (rodada 15-A) — tela Equipe,
// só admin (PATCH /api/equipe/[id]). Numa transação:
//   1. trava TODOS os admins ativos (`for update`) e depois a pessoa-alvo —
//      sempre nessa ordem, então duas mudanças simultâneas (dois admins se
//      rebaixando ao mesmo tempo) são serializadas e a segunda já vê a
//      primeira; nunca sobra zero admin por corrida;
//   2. recusa (409) tirar o papel de admin do ÚLTIMO admin ativo — o
//      sistema ficaria sem ninguém capaz de administrar a equipe (só dá pra
//      acontecer com a própria pessoa: quem chama é admin, então se o alvo é
//      o último admin, o alvo é quem está chamando);
//   3. grava o papel novo, um token_version novo (Date.now(), mesmo
//      critério de lib/auth.ts#trocarSenha — invalida na hora todo access
//      token já emitido) e revoga toda sessão (refresh token) da pessoa:
//      ela precisa entrar de novo e já entra com o acesso novo.
// Mesmo papel que já tinha → nada muda (sem derrubar a sessão à toa).

import { query, withTransaction, type Executor } from "./db";
import type { Papel } from "./papeis";

export type ResultadoAlterarPapel =
  | { ok: true; mudou: boolean; papel: Papel }
  | { ok: false; motivo: "nao_encontrado" | "ultimo_admin" };

class Recusa extends Error {
  constructor(readonly resultado: Extract<ResultadoAlterarPapel, { ok: false }>) {
    super("mudança de papel recusada");
  }
}

/**
 * `executor` opcional: roda dentro de uma transação que já existe (o teste
 * de integração usa uma transação sempre desfeita — assim consegue simular
 * "só sobrou um admin" sem tocar nas contas reais do banco local).
 */
export async function alterarPapel(alvoId: string, novoPapel: Papel, executor?: Executor): Promise<ResultadoAlterarPapel> {
  const aplicar = async (c: Executor): Promise<ResultadoAlterarPapel> => {
    const admins = await query<{ id: string }>(`select id from equipe_nexaigen where papel = 'admin' and ativo order by id for update`, [], c);
    const [alvo] = await query<{ papel: Papel; ativo: boolean }>(`select papel, ativo from equipe_nexaigen where id = $1 for update`, [alvoId], c);
    if (!alvo) throw new Recusa({ ok: false, motivo: "nao_encontrado" });
    if (alvo.papel === novoPapel) return { ok: true as const, mudou: false, papel: novoPapel };

    const deixaDeSerAdmin = alvo.papel === "admin" && alvo.ativo;
    if (deixaDeSerAdmin && admins.length <= 1) throw new Recusa({ ok: false, motivo: "ultimo_admin" });

    await query(`update equipe_nexaigen set papel = $1, token_version = $2, atualizado_em = now() where id = $3`, [novoPapel, Date.now(), alvoId], c);
    await query(`update sessao set revogado_em = now() where equipe_id = $1 and revogado_em is null`, [alvoId], c);
    return { ok: true as const, mudou: true, papel: novoPapel };
  };
  try {
    return await (executor ? aplicar(executor) : withTransaction(aplicar));
  } catch (erro) {
    if (erro instanceof Recusa) return erro.resultado;
    throw erro;
  }
}
