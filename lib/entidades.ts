// Entidades intermunicipais (rodada 16-A2) — REGRAS PURAS: tipos, rótulos,
// aviso de verificação antiga e leitura de data. Schemas: lib/entidadeSchemas.ts;
// CSV: lib/entidadesCsv.ts; gravação: lib/entidadesServico.ts.

import { dataIsoValida } from "./estadoNota";
import { UF_POR_CODIGO } from "./ibge";

export const TIPOS_ENTIDADE = ["associacao_municipios", "consorcio_intermunicipal", "associacao_regional", "outro"] as const;
export type TipoEntidade = (typeof TIPOS_ENTIDADE)[number];
export const ROTULO_TIPO_ENTIDADE: Record<TipoEntidade, string> = {
  associacao_municipios: "Associação de municípios",
  consorcio_intermunicipal: "Consórcio intermunicipal",
  associacao_regional: "Associação regional",
  outro: "Outro"
};

export const UFS_BRASIL = Object.values(UF_POR_CODIGO).sort();

// --- Verificação ------------------------------------------------------------------

export const MESES_VERIFICACAO = 12;

/** A verificação da fonte tem MAIS de 12 meses? (A tela avisa; nunca bloqueia.) */
export function verificacaoAntiga(verificadoEm: string, hoje: string): boolean {
  const [a, m, d] = hoje.split("-").map(Number);
  const limite = new Date(Date.UTC(a - MESES_VERIFICACAO / 12, m - 1, d)).toISOString().slice(0, 10);
  return verificadoEm < limite;
}

/** "31/03/2026" ou "2026-03-31" → "2026-03-31"; qualquer outra coisa → null. */
export function lerDataCsv(texto: string): string | null {
  const t = texto.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : t;
  return dataIsoValida(iso) ? iso : null;
}
