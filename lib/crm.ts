// CRM de leads (rodada 16-A) — REGRAS PURAS (sem banco, "hoje" sempre como
// parâmetro). Testado em lib/crm.test.ts. Escrita: lib/crmServico.ts;
// leitura com o filtro por vendedor no SQL: lib/crmRepositorio.ts.
//
// ETAPAS: novo → contato → demonstracao → proposta → negociacao (ABERTAS),
// e as fechadas ganho / perdido. Entre as abertas pode avançar ou voltar
// livremente; perder exige motivo; de 'perdido' só se REABRE (volta pra
// 'contato'). 'ganho' EXISTE no banco mas NINGUÉM marca nesta rodada: o
// fechamento (lead vira cliente) é o fluxo da rodada 16-B — não há atalho.

import { somarDias } from "./estadoNota";
import { nomeDeMunicipioNormalizado } from "./ibge";
import { statusContratoNaData } from "./cancelamentoContrato";
import { valoresPadrao, type IdPlano } from "./planos";

export const ETAPAS_ABERTAS = ["novo", "contato", "demonstracao", "proposta", "negociacao"] as const;
export const ETAPAS = [...ETAPAS_ABERTAS, "ganho", "perdido"] as const;
export type EtapaAberta = (typeof ETAPAS_ABERTAS)[number];
export type Etapa = (typeof ETAPAS)[number];

export const ROTULO_ETAPA: Record<Etapa, string> = {
  novo: "Novo",
  contato: "Contato",
  demonstracao: "Demonstração",
  proposta: "Proposta",
  negociacao: "Negociação",
  ganho: "Ganho",
  perdido: "Perdido"
};

export const ORIGENS = ["indicacao", "evento", "site", "contato_direto", "outro"] as const;
export type Origem = (typeof ORIGENS)[number];
export const ROTULO_ORIGEM: Record<Origem, string> = { indicacao: "Indicação", evento: "Evento", site: "Site", contato_direto: "Contato direto", outro: "Outro" };

export const MOTIVOS_PERDA = ["preco", "sem_orcamento", "concorrente", "sem_interesse", "sem_resposta", "outro"] as const;
export type MotivoPerda = (typeof MOTIVOS_PERDA)[number];
export const ROTULO_MOTIVO_PERDA: Record<MotivoPerda, string> = {
  preco: "Preço",
  sem_orcamento: "Sem orçamento",
  concorrente: "Concorrente",
  sem_interesse: "Sem interesse",
  sem_resposta: "Sem resposta",
  outro: "Outro"
};

/** Interações que a equipe registra à mão (as demais o sistema grava sozinho). */
export const TIPOS_CONTATO = ["nota", "ligacao", "email", "reuniao", "whatsapp", "visita"] as const;
export type TipoContato = (typeof TIPOS_CONTATO)[number];
export const TIPOS_INTERACAO = [...TIPOS_CONTATO, "mudanca_etapa", "troca_vendedor", "edicao", "reabertura"] as const;
export type TipoInteracao = (typeof TIPOS_INTERACAO)[number];
export const ROTULO_INTERACAO: Record<TipoInteracao, string> = {
  nota: "Nota",
  ligacao: "Ligação",
  email: "E-mail",
  reuniao: "Reunião",
  whatsapp: "WhatsApp",
  visita: "Visita",
  mudanca_etapa: "Mudança de etapa",
  troca_vendedor: "Troca de vendedor",
  edicao: "Edição do cadastro",
  reabertura: "Reabertura"
};

/**
 * O que conta como ATIVIDADE (pro "parado há N dias", a "última atividade"
 * da consulta e o pedido de reatribuição): contato registrado ou mudança
 * de etapa/reabertura. Editar o cadastro ou trocar o vendedor NÃO conta —
 * corrigir um telefone não é trabalhar o lead. Sem nenhuma, vale a data de
 * criação do lead. A MESMA lista entra no SQL (lib/crmRepositorio.ts).
 */
export const TIPOS_ATIVIDADE: readonly TipoInteracao[] = [...TIPOS_CONTATO, "mudanca_etapa", "reabertura"];

export const AVISO_LGPD = "Não registre dados pessoais de cidadãos, crianças ou famílias — só informações comerciais da prefeitura.";
export const MENSAGEM_GANHO_BLOQUEADO = "O fechamento é feito pelo fluxo de fechamento (rodada 16-B) — a etapa 'ganho' não pode ser marcada por aqui.";

export function etapaAberta(etapa: string): etapa is EtapaAberta {
  return (ETAPAS_ABERTAS as readonly string[]).includes(etapa);
}

// --- Transições -------------------------------------------------------------------

export type AcaoEtapa = { acao: "mover"; etapa: Etapa } | { acao: "perder"; motivo: MotivoPerda; detalhe: string | null } | { acao: "reabrir" };

export type ResultadoTransicao = { ok: true; etapaNova: Etapa; tipoHistorico: "mudanca_etapa" | "reabertura" } | { ok: false; erro: string };

/**
 * Regras de transição. 'ganho' sempre recusado (rodada 16-B). Aberto →
 * qualquer outra aberta (avançar ou voltar) ou perdido (com motivo — o
 * schema já exige). Perdido → só reabrir (volta pra 'contato'). Ganho →
 * nada (é fechamento).
 */
export function validarTransicao(atual: string, acao: AcaoEtapa): ResultadoTransicao {
  if (acao.acao === "mover" && acao.etapa === "ganho") return { ok: false, erro: MENSAGEM_GANHO_BLOQUEADO };
  if (atual === "ganho") return { ok: false, erro: "Este lead já foi fechado — não muda mais de etapa." };
  if (acao.acao === "reabrir") {
    return atual === "perdido" ? { ok: true, etapaNova: "contato", tipoHistorico: "reabertura" } : { ok: false, erro: "Só um lead perdido pode ser reaberto." };
  }
  if (atual === "perdido") return { ok: false, erro: "Este lead está perdido — reabra antes de mudar a etapa." };
  if (acao.acao === "perder") return { ok: true, etapaNova: "perdido", tipoHistorico: "mudanca_etapa" };
  if (acao.etapa === "perdido") return { ok: false, erro: "Para marcar como perdido, informe o motivo da perda." };
  if (acao.etapa === atual) return { ok: false, erro: `O lead já está na etapa ${ROTULO_ETAPA[acao.etapa]}.` };
  return { ok: true, etapaNova: acao.etapa, tipoHistorico: "mudanca_etapa" };
}

// --- Datas e selos -------------------------------------------------------------------

export const DIAS_PARADO = 14;
export const DIAS_PARA_PEDIR_LEAD = 60;

/** Dia civil em America/Sao_Paulo de um instante ISO (timestamptz) — "2026-11-18". */
export function diaEmSaoPaulo(instanteIso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instanteIso));
}

function diasEntre(inicio: string, fim: string): number {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000);
}

/** Dias desde a última atividade (dia em SP) até hoje. */
export function diasSemAtividade(ultimaAtividadeEm: string, hoje: string): number {
  return Math.max(0, diasEntre(diaEmSaoPaulo(ultimaAtividadeEm), hoje));
}

/** "Parado": lead aberto sem atividade há MAIS de 14 dias. */
export function leadParado(etapa: string, ultimaAtividadeEm: string, hoje: string): boolean {
  return etapaAberta(etapa) && diasSemAtividade(ultimaAtividadeEm, hoje) > DIAS_PARADO;
}

/** "Ação vencida": lead aberto com próxima ação ANTES de hoje. */
export function acaoVencida(etapa: string, proximaAcaoEm: string | null, hoje: string): boolean {
  return etapaAberta(etapa) && proximaAcaoEm !== null && proximaAcaoEm < hoje;
}

/** "Ações de hoje": lead aberto com próxima ação hoje ou vencida. */
export function acaoParaHoje(etapa: string, proximaAcaoEm: string | null, hoje: string): boolean {
  return etapaAberta(etapa) && proximaAcaoEm !== null && proximaAcaoEm <= hoje;
}

/** Pode pedir o lead de um colega: aberto e sem atividade há MAIS de 60 dias. */
export function podePedirLead(etapa: string, ultimaAtividadeEm: string, hoje: string): boolean {
  return etapaAberta(etapa) && diasSemAtividade(ultimaAtividadeEm, hoje) > DIAS_PARA_PEDIR_LEAD;
}

/** Data de corte do SQL: atividade (dia em SP) ANTES deste dia = mais de `dias` dias parado. */
export function corteDeDias(hoje: string, dias: number): string {
  return somarDias(hoje, -dias);
}

// --- Preço ---------------------------------------------------------------------------

/** Valor estimado sugerido = mensalidade padrão do plano (lib/planos.ts — a tabela de preços é uma só). */
export function valorSugeridoCentavos(plano: IdPlano): number {
  return valoresPadrao(plano).valorMensalCentavos;
}

// --- Taxa de avanço ------------------------------------------------------------------

export interface TaxaAvanco {
  de: EtapaAberta;
  para: EtapaAberta | "ganho";
  /** Leads que chegaram em `de` (ou além). */
  entraram: number;
  /** Desses, quantos já chegaram em `para` (ou além). */
  passaram: number;
  /** passaram ÷ entraram, 1 casa decimal (%). null quando ninguém entrou — "—", nunca divisão por zero. */
  percentual: number | null;
}

const ORDEM_FUNIL: readonly (EtapaAberta | "ganho")[] = [...ETAPAS_ABERTAS, "ganho"];

/**
 * TAXA DE AVANÇO entre etapas consecutivas do funil. Pra cada lead, a
 * "maior etapa alcançada" = a mais avançada entre a etapa de criação
 * ('novo'), toda etapa nova registrada no histórico e a etapa atual
 * (perdido não conta como avanço: um lead perdido em Proposta alcançou
 * Proposta). Então, de X pra Y (a seguinte):
 *   entraram(X) = leads com maior etapa ≥ X
 *   passaram    = leads com maior etapa ≥ Y
 *   taxa        = passaram ÷ entraram
 * Pular etapa conta como ter passado pelas do meio (quem foi de Novo direto
 * pra Proposta passou de Contato). A última taxa (Negociação → Ganho) fica
 * 0 até a 16-B criar o fechamento.
 */
export function calcularTaxasDeAvanco(etapasAlcancadasPorLead: readonly (readonly string[])[]): TaxaAvanco[] {
  const maiores = etapasAlcancadasPorLead.map((etapas) => Math.max(0, ...etapas.map((e) => ORDEM_FUNIL.indexOf(e as EtapaAberta)).filter((i) => i >= 0)));
  return ORDEM_FUNIL.slice(0, -1).map((de, i) => {
    const entraram = maiores.filter((m) => m >= i).length;
    const passaram = maiores.filter((m) => m >= i + 1).length;
    return { de: de as EtapaAberta, para: ORDEM_FUNIL[i + 1], entraram, passaram, percentual: entraram === 0 ? null : Math.round((passaram / entraram) * 1000) / 10 };
  });
}

// --- Cliente do mesmo município (duplicidade e "ex-cliente") ---------------------------

export interface ClienteDoMunicipio {
  nome: string;
  uf: string;
  codigo_ibge: string | null;
  status_contrato: string;
  cancelamento_termino_em: string | null;
  /** Data do evento 'contrato_encerrado' mais recente (trilha da 0011), se houver. */
  encerrado_em: string | null;
}

/** Clientes do MESMO município do lead: mesmo código IBGE, ou mesma UF + nome normalizado (sem acento/caixa/"Prefeitura de"). */
export function clientesDoMunicipio<T extends Pick<ClienteDoMunicipio, "nome" | "uf" | "codigo_ibge">>(
  clientes: readonly T[],
  lead: { uf: string; nomeBusca: string; codigoIbge: string | null }
): T[] {
  return clientes.filter((c) => (lead.codigoIbge !== null && c.codigo_ibge === lead.codigoIbge) || (c.uf === lead.uf && nomeDeMunicipioNormalizado(c.nome) === lead.nomeBusca));
}

/**
 * EX-CLIENTE (rodada 16-A1): cliente cujo contrato, NA DATA DE HOJE, está
 * encerrado (inclusive aviso prévio com término já passado —
 * lib/cancelamentoContrato.ts#statusContratoNaData). Lead desse município é
 * PERMITIDO e leva a marca "ex-cliente". Cliente ativo, em aviso prévio
 * (encerrando) ou suspenso continua BLOQUEANDO o lead. (Cliente eliminado
 * do cadastro simplesmente não existe mais — não bloqueia nem marca.)
 */
export function clienteEncerrado(c: Pick<ClienteDoMunicipio, "status_contrato" | "cancelamento_termino_em">, hoje: string): boolean {
  return statusContratoNaData(c, hoje) === "encerrado";
}

/** Data do encerramento do ex-cliente: o evento de encerramento, senão o término do aviso prévio; null quando não há registro (encerrado antes da trilha). */
export function dataDoEncerramento(c: Pick<ClienteDoMunicipio, "encerrado_em" | "cancelamento_termino_em">): string | null {
  return c.encerrado_em ?? c.cancelamento_termino_em;
}
