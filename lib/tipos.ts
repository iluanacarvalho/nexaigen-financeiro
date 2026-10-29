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

/** GET /api/notas — nota com o resumo do cliente embutido (json_build_object). */
export interface NotaComCliente extends NotaFiscal {
  cliente: { nome: string; uf: string; sistema_portal: string | null; portal_url: string | null };
}

/** Linha de cliente_prefeitura (GET /api/clientes, `select *`). */
export interface ClientePrefeitura {
  id: string;
  nome: string;
  uf: string;
  cnpj: string | null;
  plano: "essencial" | "completo";
  valor_mensal: string;
  dia_vencimento_contrato: number;
  data_inicio_contrato: string;
  status_contrato: "ativo" | "suspenso" | "encerrado";
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
