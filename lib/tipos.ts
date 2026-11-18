export type StatusNota =
  | "emitida"
  | "aguardando_atesto"
  | "atestada"
  | "vencida"
  | "paga"
  | "atraso_critico"
  | "cancelada";

export type TipoAlerta = "sem_atesto_prolongado" | "proximo_vencimento" | "vencido" | "atraso_60_dias";

// Formato das linhas como CHEGAM no JSON das rotas (ver os type parsers
// em lib/db.ts): numeric → string ("4500.50"), date → "aaaa-mm-dd" crua,
// timestamptz → ISO 8601 completa.

export interface NotaFiscal {
  id: string;
  cliente_id: string;
  competencia: string; // date, primeiro dia do mês
  numero_nf: string | null;
  valor: string; // numeric — string, nunca number (ver lib/db.ts)
  data_emissao: string;
  data_atesto: string | null;
  data_limite_pagamento: string | null;
  data_pagamento: string | null;
  status: StatusNota;
  arquivo_pdf_chave: string | null;
  arquivo_pdf_nome: string | null;
  created_at: string;
}

/**
 * Uma versão de PDF com histórico — nota fiscal (GET /api/notas/[id]/arquivo/versoes)
 * ou contrato (GET /api/clientes/[id]/contrato/versoes). Mesmo formato pros dois.
 */
export interface VersaoArquivoPdf {
  versao: number;
  nome: string;
  tamanho_bytes: number | null; // nulo só em versão vinda de backfill (0005/0009) ainda não recalculada (npm run recalcular-hash-versoes)
  sha256: string | null; // idem
  enviado_em: string;
  enviado_por_nome: string | null; // nulo no backfill (autor desconhecido) e no contrato enviado pela integração com o Educa
  motivo: string | null;
  atual: boolean;
}

/** Linha de cliente_prefeitura (GET /api/clientes, `select *`). */
export interface ClientePrefeitura {
  /** Versão atual do contrato (cliente_contrato_versao, 0009) — null sem contrato. */
  contrato_versao_atual?: number | null;
  id: string;
  nome: string;
  uf: string;
  cnpj: string | null;
  plano: "dispensa" | "pequeno_porte" | "medio_porte" | "grande_porte"; // lib/planos.ts
  /** Taxa de implantação e treinamento COMBINADA (numeric em string, ex. "15000.00"); null = sem implantação. */
  taxa_implantacao: string | null;
  /** Já existe nota de implantação não cancelada (GET /api/clientes) — sem ela, o cliente tem "Implantação a cobrar". */
  tem_implantacao_ativa?: boolean;
  valor_mensal: string;
  dia_vencimento_contrato: number;
  data_inicio_contrato: string;
  status_contrato: "ativo" | "em_aviso_previo" | "suspenso" | "encerrado"; // lib/cancelamentoContrato.ts
  /** Data de recebimento do ofício de cancelamento (0011) — null sem cancelamento registrado. */
  cancelamento_pedido_em: string | null;
  /** Término do aviso prévio = pedido + 30 dias (0011). Continua preenchido depois do encerramento. */
  cancelamento_termino_em: string | null;
  cancelamento_motivo: string | null;
  /** GET /api/clientes: já existe nota de mensalidade (não cancelada) da competência do último período — some o botão "Criar nota final". */
  nota_final_emitida?: boolean;
  /** Mapa público (0013): código IBGE do município (7 dígitos) e centroide gravado (numeric em string). */
  codigo_ibge: string | null;
  latitude: string | null;
  longitude: string | null;
  /** Autorizado POR ESCRITO a aparecer no mapa público (lib/mapaPublico.ts). */
  autorizacao_divulgacao: boolean;
  autorizacao_divulgacao_em: string | null;
  /** GET /api/clientes: nome de quem autorizou (nunca o e-mail). */
  autorizacao_divulgacao_por_nome?: string | null;
  sistema_portal: string | null;
  portal_url: string | null;
  portal_usuario: string | null;
  contato_nome: string | null;
  contato_email: string | null;
  contato_telefone: string | null;
  observacao: string | null;
  contrato_arquivo_chave: string | null;
  contrato_arquivo_nome: string | null;
  municipio_id_externo: string | null;
  created_at: string;
}

/** Alerta ativo com nota e cliente embutidos (GET /api/alertas e a página /alertas). */
export interface AlertaComNota {
  id: string;
  nota_fiscal_id: string;
  tipo: TipoAlerta;
  gerado_em: string;
  status: "pendente" | "em_andamento" | "resolvido";
  atribuido_a: string | null;
  resolvido_em: string | null;
  observacao: string | null;
  nota: {
    numero_nf: string | null;
    valor: string;
    data_limite_pagamento: string | null;
    cliente: { nome: string; uf: string; contato_email: string | null; contato_telefone: string | null };
  };
}

/** Nome usado pela UI da nota fiscal desde a rodada 06. */
export type VersaoArquivoNota = VersaoArquivoPdf;

/** Situação da nota na data de hoje — ver lib/estadoNota.ts#SituacaoNota (mesmo vocabulário). */
export type SituacaoNotaListada = "aguardando_atesto" | "atestada" | "vencida" | "atraso_critico" | "paga" | "cancelada";

/** Uma linha de GET /api/notas (lib/notasServico.ts#listarNotas). */
/** Mensalidade (recorrente) ou implantação (cobrança única) — nota_fiscal.tipo (0010). */
export type TipoNota = "mensalidade" | "implantacao";

export interface NotaListada {
  tipo: TipoNota;
  id: string;
  cliente_id: string;
  numero_nf: string | null;
  valor: string;
  competencia: string;
  data_emissao: string;
  data_atesto: string | null;
  data_limite_pagamento: string | null;
  data_pagamento: string | null;
  status: string;
  situacao: SituacaoNotaListada;
  motivo_cancelamento: string | null;
  cancelado_em: string | null;
  arquivo_pdf_nome: string | null;
  arquivo_pdf_versao_atual: number | null;
  cliente: { id: string; nome: string; uf: string; sistema_portal: string | null; portal_url: string | null };
}

export type TipoEventoNota = "criacao" | "verificacao_portal" | "atesto" | "pagamento" | "cancelamento" | "reabertura_pagamento";

/** Uma linha do histórico da nota (GET /api/notas/[id]/eventos). */
export interface EventoNota {
  id: string;
  tipo: TipoEventoNota;
  status_anterior: string | null;
  status_novo: string | null;
  data_evento: string | null;
  motivo: string | null;
  observacao: string | null;
  feito_por_nome: string | null;
  feito_em: string;
}
