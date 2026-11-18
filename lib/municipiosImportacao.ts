// Gravação da base de municípios (rodada 16-A2) — usada por
// scripts/importar-municipios.ts e pelo teste de integração.
//
// UPSERT idempotente numa transação: município novo é inserido; existente
// só é atualizado se algum campo MUDOU (o `where ... is distinct from`
// impede a escrita à toa — rodar duas vezes seguidas dá 0 inseridos e 0
// atualizados). NUNCA apaga: município que sumiu do arquivo continua no
// banco (lead/cliente/entidade podem apontar pra ele).

import { query, withTransaction, type Executor } from "./db";
import type { MunicipioParaGravar } from "./baseMunicipios";

export interface ResultadoImportacaoMunicipios {
  inseridos: number;
  atualizados: number;
  inalterados: number;
  totalDaUf: number;
}

export async function importarMunicipios(uf: string, municipios: MunicipioParaGravar[], executor?: Executor): Promise<ResultadoImportacaoMunicipios> {
  const gravar = async (c: Executor): Promise<ResultadoImportacaoMunicipios> => {
    const coluna = <K extends keyof MunicipioParaGravar>(k: K) => municipios.map((m) => m[k]);
    const linhas = await query<{ inserido: boolean }>(
      `insert into municipio_base (codigo_ibge, nome, nome_busca, uf, populacao, populacao_ano, microrregiao, mesorregiao)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[], $6::int[], $7::text[], $8::text[])
       on conflict (codigo_ibge) do update set
         nome = excluded.nome, nome_busca = excluded.nome_busca, uf = excluded.uf, populacao = excluded.populacao,
         populacao_ano = excluded.populacao_ano, microrregiao = excluded.microrregiao, mesorregiao = excluded.mesorregiao,
         atualizado_em = now()
       where (municipio_base.nome, municipio_base.nome_busca, municipio_base.uf, municipio_base.populacao, municipio_base.populacao_ano,
              municipio_base.microrregiao, municipio_base.mesorregiao)
         is distinct from (excluded.nome, excluded.nome_busca, excluded.uf, excluded.populacao, excluded.populacao_ano,
              excluded.microrregiao, excluded.mesorregiao)
       returning (xmax = 0) as inserido`,
      [
        coluna("codigo_ibge"), coluna("nome"), coluna("nome_busca"), coluna("uf"), coluna("populacao"),
        coluna("populacao_ano"), coluna("microrregiao"), coluna("mesorregiao")
      ],
      c
    );
    const [{ n }] = await query<{ n: number }>(`select count(*)::int as n from municipio_base where uf = $1`, [uf], c);
    const inseridos = linhas.filter((l) => l.inserido).length;
    const atualizados = linhas.length - inseridos;
    return { inseridos, atualizados, inalterados: municipios.length - linhas.length, totalDaUf: n };
  };
  return executor ? gravar(executor) : withTransaction(gravar);
}
