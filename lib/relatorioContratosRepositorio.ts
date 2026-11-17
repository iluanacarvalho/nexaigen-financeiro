// Leitura do banco pro relatório de novos contratos (rodada 15-A): DUAS
// queries fixas, sem N+1, em paralelo — todos os clientes (a série de 12
// meses, o mês anterior e o MRR da carteira precisam da base inteira; é
// uma tabela pequena, mono-tenant) e a trilha cliente_evento_contrato. Toda
// conta é feita em lib/relatorioContratos.ts (puro). Nenhum dado de
// contato é lido. `executor` opcional: o teste de integração roda dentro
// de uma transação desfeita.

import { query, type Executor } from "./db";
import { hojeEmSaoPaulo } from "./painelFinanceiro";
import { montarRelatorioContratos, type LinhaClienteRelatorio, type LinhaEventoContrato, type RelatorioContratos } from "./relatorioContratos";

export async function lerDadosRelatorio(executor?: Executor): Promise<{ clientes: LinhaClienteRelatorio[]; eventos: LinhaEventoContrato[] }> {
  const [clientes, eventos] = await Promise.all([
    query<LinhaClienteRelatorio>(
      `select c.id, c.nome, c.uf, c.plano, c.valor_mensal, c.status_contrato, c.taxa_implantacao, c.cancelamento_termino_em,
         c.data_inicio_contrato, c.municipio_id_externo,
         exists (select 1 from nota_fiscal n where n.cliente_id = c.id and n.tipo = 'implantacao' and n.status <> 'cancelada') as tem_implantacao_ativa
       from cliente_prefeitura c
       order by c.nome`,
      [],
      executor
    ),
    query<LinhaEventoContrato>(`select cliente_id, tipo, data_evento, criado_em from cliente_evento_contrato`, [], executor)
  ]);
  return { clientes, eventos };
}

/** Relatório de `mes` ("aaaa-mm") com "hoje" em America/Sao_Paulo. `agora` só é parâmetro pra teste. */
export async function obterRelatorioContratos(mes: string, agora: Date = new Date(), executor?: Executor): Promise<RelatorioContratos> {
  const { clientes, eventos } = await lerDadosRelatorio(executor);
  return montarRelatorioContratos({ clientes, eventos, mes, hoje: hojeEmSaoPaulo(agora) });
}
