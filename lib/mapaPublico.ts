// Mapa PÚBLICO das prefeituras atendidas (rodada 15-B) — regras PURAS.
// Testado em lib/mapaPublico.test.ts.
//
// REGRA CENTRAL: só aparece quem AUTORIZOU por escrito (cláusula de
// divulgação no contrato) — autorizacao_divulgacao, marcada à mão na tela
// de Clientes — E tem contrato vigente HOJE: 'ativo' ou 'em_aviso_previo'
// (status na data de hoje, lib/cancelamentoContrato.ts#statusContratoNaData:
// aviso com término passado já conta como encerrado). Suspenso e encerrado
// nunca aparecem, mesmo autorizados.
//
// O JSON público tem EXATAMENTE { atualizadoEm, total, municipios: [{ nome,
// uf, lat, lon }] } — nenhum id, e-mail, plano, valor, contrato, código
// IBGE ou data por cliente. Quem monta é montarJsonPublico, e só ela.

import { statusContratoNaData } from "./cancelamentoContrato";

export const STATUS_QUE_APARECEM: readonly string[] = ["ativo", "em_aviso_previo"];

export interface LinhaClienteMapa {
  nome: string;
  uf: string;
  status_contrato: string;
  cancelamento_termino_em: string | null;
  autorizacao_divulgacao: boolean;
  /** numeric(9,6) chega como string do driver "pg". */
  latitude: string | null;
  longitude: string | null;
}

export interface MunicipioPublico {
  nome: string;
  uf: string;
  lat: number;
  lon: number;
}

export interface JsonMapaPublico {
  atualizadoEm: string;
  total: number;
  municipios: MunicipioPublico[];
}

/** Aparece no mapa hoje? Autorizado + posição + contrato vigente na data de hoje. */
export function elegivelNoMapa(c: LinhaClienteMapa, hoje: string): boolean {
  return c.autorizacao_divulgacao && c.latitude !== null && c.longitude !== null && STATUS_QUE_APARECEM.includes(statusContratoNaData(c, hoje));
}

/** O ÚNICO lugar que monta a resposta pública — objeto novo, só com as 4 chaves por município. */
export function montarJsonPublico(linhas: LinhaClienteMapa[], hoje: string, agora: Date): JsonMapaPublico {
  const municipios = linhas
    .filter((c) => elegivelNoMapa(c, hoje))
    .map((c) => ({ nome: c.nome, uf: c.uf, lat: Number(c.latitude), lon: Number(c.longitude) }))
    .sort((a, b) => a.uf.localeCompare(b.uf) || a.nome.localeCompare(b.nome, "pt-BR"));
  return { atualizadoEm: agora.toISOString(), total: municipios.length, municipios };
}

// --- Etiqueta da tela de Clientes ---------------------------------------------------

export type SituacaoDivulgacao = "no_mapa" | "fora_do_mapa" | "sem_autorizacao" | "posicao_pendente" | "sem_codigo";

export const ROTULO_SITUACAO_DIVULGACAO: Record<SituacaoDivulgacao, string> = {
  no_mapa: "No mapa",
  fora_do_mapa: "Autorizado, fora do mapa (contrato não vigente)",
  sem_autorizacao: "Sem autorização",
  posicao_pendente: "Posição pendente",
  sem_codigo: "Sem código IBGE"
};

export function situacaoDivulgacao(c: LinhaClienteMapa & { codigo_ibge: string | null }, hoje: string): SituacaoDivulgacao {
  if (!c.codigo_ibge) return "sem_codigo";
  if (c.latitude === null || c.longitude === null) return "posicao_pendente";
  if (!c.autorizacao_divulgacao) return "sem_autorizacao";
  return elegivelNoMapa(c, hoje) ? "no_mapa" : "fora_do_mapa";
}
