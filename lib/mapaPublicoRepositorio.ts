// Leitura do mapa público (rodada 15-B): UMA query, só as colunas que a
// regra precisa — e já filtrada pelos autorizados com posição (o resto da
// regra, contrato vigente na data de hoje, é lib/mapaPublico.ts). Nunca lê
// id, contato, plano, valor nem código IBGE: o que não sai do banco não
// tem como vazar. Usado pelo endpoint público E pela página /mapa (mesma
// função, mesmo resultado). `executor` opcional (teste em transação desfeita).

import { query, type Executor } from "./db";
import { hojeEmSaoPaulo } from "./painelFinanceiro";
import { montarJsonPublico, type JsonMapaPublico, type LinhaClienteMapa } from "./mapaPublico";

export async function obterMapaPublico(agora: Date = new Date(), executor?: Executor): Promise<JsonMapaPublico> {
  const linhas = await query<LinhaClienteMapa>(
    `select nome, uf, status_contrato, cancelamento_termino_em, autorizacao_divulgacao, latitude, longitude
     from cliente_prefeitura
     where autorizacao_divulgacao and latitude is not null and longitude is not null
       and status_contrato in ('ativo', 'em_aviso_previo')`,
    [],
    executor
  );
  return montarJsonPublico(linhas, hojeEmSaoPaulo(agora), agora);
}
