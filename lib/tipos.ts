export type StatusNota =
  | "emitida"
  | "aguardando_atesto"
  | "atestada"
  | "vencida"
  | "paga"
  | "atraso_critico"
  | "cancelada";

export type TipoAlerta = "sem_atesto_prolongado" | "proximo_vencimento" | "vencido" | "atraso_60_dias";

export interface NotaFiscal {
  id: string;
  cliente_id: string;
  competencia: string; // ISO date, primeiro dia do mês
  numero_nf: string | null;
  valor: number;
  data_emissao: string; // ISO date
  data_atesto: string | null;
  data_limite_pagamento: string | null;
  data_pagamento: string | null;
  status: StatusNota;
}
