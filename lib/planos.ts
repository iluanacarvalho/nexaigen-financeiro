// Planos de contrato (rodada 11-A) — FONTE ÚNICA. Decisão de produto da
// Luana: TODO plano dá acesso a TUDO; o plano muda SÓ a precificação
// (mensalidade e taxa de implantação). Nenhuma funcionalidade do sistema
// deve consultar o plano pra liberar/bloquear recurso.
//
// Valores em CENTAVOS inteiros (lib/dinheiro.ts) — nunca float. São o
// PADRÃO sugerido: o valor combinado de cada cliente pode ser diferente e
// fica gravado em cliente_prefeitura.valor_mensal / taxa_implantacao.
//
// Funções puras — testadas em lib/planos.test.ts.

export const IDS_PLANOS = ["dispensa", "pequeno_porte", "medio_porte", "grande_porte"] as const;
export type IdPlano = (typeof IDS_PLANOS)[number];

/** Ids dos planos anteriores à rodada 11-A — reconhecidos SÓ pra dar uma mensagem clara de erro, nunca mapeados em silêncio. */
export const IDS_PLANOS_DESCONTINUADOS = ["essencial", "completo"] as const;

export interface Plano {
  id: IdPlano;
  rotulo: string;
  valorMensalCentavos: number;
  /** null = o plano não tem implantação (Dispensa). */
  taxaImplantacaoCentavos: number | null;
  /**
   * FAIXA DE POPULAÇÃO do plano (rodada 16-A2, regra confirmada pela dona do
   * produto) — FONTE ÚNICA. Cada faixa COMEÇA no número indicado:
   * populacaoMinima ≤ população ≤ populacaoMaxima (inteiros, inclusive);
   * populacaoMaxima null = sem teto (Grande Porte).
   */
  populacaoMinima: number;
  populacaoMaxima: number | null;
  /** Texto da faixa pra exibição (sempre coerente com populacaoMinima/Maxima — conferido em lib/planos.test.ts). */
  faixaHabitantes: string;
}

export const PLANOS: readonly Plano[] = [
  { id: "dispensa", rotulo: "Dispensa", valorMensalCentavos: 545700, taxaImplantacaoCentavos: null, populacaoMinima: 0, populacaoMaxima: 9_999, faixaHabitantes: "Menos de 10 mil hab." },
  { id: "pequeno_porte", rotulo: "Pequeno Porte", valorMensalCentavos: 850000, taxaImplantacaoCentavos: 1500000, populacaoMinima: 10_000, populacaoMaxima: 49_999, faixaHabitantes: "10 mil a menos de 50 mil hab." },
  { id: "medio_porte", rotulo: "Médio Porte", valorMensalCentavos: 1500000, taxaImplantacaoCentavos: 2000000, populacaoMinima: 50_000, populacaoMaxima: 199_999, faixaHabitantes: "50 mil a menos de 200 mil hab." },
  { id: "grande_porte", rotulo: "Grande Porte", valorMensalCentavos: 3500000, taxaImplantacaoCentavos: 3000000, populacaoMinima: 200_000, populacaoMaxima: null, faixaHabitantes: "200 mil hab. ou mais" }
];

/**
 * Plano SUGERIDO pela população (rodada 16-A2): o plano cuja faixa contém
 * a população. Só sugestão — o plano contratado/de interesse sempre vence
 * (lib/territorio.ts#planoEfetivo). População nula, negativa ou não inteira → null.
 */
export function planoSugeridoPorPopulacao(populacao: number | null | undefined): IdPlano | null {
  if (populacao === null || populacao === undefined || !Number.isInteger(populacao) || populacao < 0) return null;
  return PLANOS.find((p) => populacao >= p.populacaoMinima && (p.populacaoMaxima === null || populacao <= p.populacaoMaxima))?.id ?? null;
}

export function ehIdPlano(valor: unknown): valor is IdPlano {
  return typeof valor === "string" && (IDS_PLANOS as readonly string[]).includes(valor);
}

/** O plano pelo id; lança pra id desconhecido (dado do banco é sempre um dos 4 — CHECK da migration 0010). */
export function obterPlano(id: string): Plano {
  const plano = PLANOS.find((p) => p.id === id);
  if (!plano) throw new Error(`Plano desconhecido: "${id}"`);
  return plano;
}

/** Rótulo pra exibição ("Pequeno Porte"); id desconhecido aparece como veio (nunca quebra uma tela). */
export function rotuloDoPlano(id: string): string {
  return PLANOS.find((p) => p.id === id)?.rotulo ?? id;
}

/** Valores padrão do plano (o que a tela sugere e o que a criação usa quando o campo não vem). */
export function valoresPadrao(id: IdPlano): { valorMensalCentavos: number; taxaImplantacaoCentavos: number | null } {
  const p = obterPlano(id);
  return { valorMensalCentavos: p.valorMensalCentavos, taxaImplantacaoCentavos: p.taxaImplantacaoCentavos };
}

/** O plano tem implantação (os 3 portes)? */
export function temImplantacao(id: IdPlano): boolean {
  return obterPlano(id).taxaImplantacaoCentavos !== null;
}

export const MENSAGEM_DISPENSA_SEM_TAXA = "O plano Dispensa não tem taxa de implantação — não envie taxa_implantacao (ou envie null).";

export function mensagemPlanoDescontinuado(id: string): string {
  return `O plano "${id}" foi descontinuado — use um destes: ${IDS_PLANOS.join(", ")}.`;
}

/**
 * Preço na CRIAÇÃO de um cliente: o servidor aceita o valor enviado (o
 * combinado pode diferir do padrão); campo AUSENTE (undefined) usa o
 * padrão do plano. taxa `null` explícito = "sem implantação combinada".
 * Dispensa nunca tem taxa: taxa enviada (não nula) é erro.
 */
export function precosDeCriacao(
  plano: IdPlano,
  enviado: { valorMensalCentavos?: number; taxaImplantacaoCentavos?: number | null }
): { ok: true; valorMensalCentavos: number; taxaImplantacaoCentavos: number | null } | { ok: false; erro: string } {
  const padrao = valoresPadrao(plano);
  if (plano === "dispensa") {
    if (enviado.taxaImplantacaoCentavos !== undefined && enviado.taxaImplantacaoCentavos !== null) return { ok: false, erro: MENSAGEM_DISPENSA_SEM_TAXA };
    return { ok: true, valorMensalCentavos: enviado.valorMensalCentavos ?? padrao.valorMensalCentavos, taxaImplantacaoCentavos: null };
  }
  return {
    ok: true,
    valorMensalCentavos: enviado.valorMensalCentavos ?? padrao.valorMensalCentavos,
    taxaImplantacaoCentavos: enviado.taxaImplantacaoCentavos === undefined ? padrao.taxaImplantacaoCentavos : enviado.taxaImplantacaoCentavos
  };
}

/**
 * "Implantação a cobrar": contrato ATIVO (ou em aviso prévio — rodada 12-A:
 * durante o aviso o contrato segue normal e a implantação feita continua
 * devida), taxa de implantação combinada e nenhuma nota de implantação
 * ativa (não cancelada). Regra ÚNICA — usada pelo Painel, pelo Dashboard
 * (via Painel), pela tela de Clientes e pela tela de Notas. A nota de
 * implantação NUNCA é criada sozinha: uma nota criada automaticamente já
 * começaria a contar prazo de atesto.
 */
export function temImplantacaoACobrar(c: { status_contrato: string; taxa_implantacao?: string | null; tem_implantacao_ativa?: boolean }): boolean {
  return (c.status_contrato === "ativo" || c.status_contrato === "em_aviso_previo") && !!c.taxa_implantacao && !c.tem_implantacao_ativa;
}

