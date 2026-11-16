// Leitura do banco pro painel financeiro: DUAS queries fixas, sem N+1
// (nunca uma consulta por cliente), rodando em paralelo. Toda agregação é
// feita depois, em lib/painelFinanceiro.ts (funções puras, testadas sem
// banco). Usado tanto pela página app/(protegido)/painel (Server
// Component lendo direto, mesmo padrão do dashboard e de /alertas) quanto
// por GET /api/painel-financeiro.
//
// Nenhum dado de contato (contato_email/contato_telefone) é sequer lido
// aqui — o painel não precisa deles, então eles não saem do banco.
//
// `executor` opcional (mesmo contrato de lib/db.ts#query): o teste de
// integração roda tudo dentro de uma transação que depois é desfeita, pra
// conferir valores exatos sem depender do que já existe no banco local.

import { query, type Executor } from "./db";
import {
  hojeEmSaoPaulo,
  mesesDaJanela,
  montarPainelFinanceiro,
  type LinhaClientePainel,
  type LinhaNotaPainel,
  type PainelFinanceiro
} from "./painelFinanceiro";

/**
 * Notas lidas: todas as não canceladas que ainda importam pro painel —
 * as em aberto (qualquer idade: entram em "a receber" e no atraso por
 * cliente) e as com competência OU pagamento dentro da janela de 12
 * meses (série, inadimplência, prazo médio). Nota paga e antiga, fora da
 * janela, não influencia nenhum número e não é lida.
 */
export async function lerDadosPainel(
  inicioJanela: string,
  executor?: Executor
): Promise<{ clientes: LinhaClientePainel[]; notas: LinhaNotaPainel[] }> {
  const [clientes, notas] = await Promise.all([
    query<LinhaClientePainel>(
      // tem_implantacao_ativa: subconsulta correlacionada por linha, na MESMA query (sem N+1) — olha TODAS as
      // notas de implantação do cliente, não só as da janela (uma paga há 2 anos não pode virar "a cobrar").
      `select c.id, c.nome, c.uf, c.plano, c.valor_mensal, c.status_contrato, c.taxa_implantacao,
         exists (select 1 from nota_fiscal n where n.cliente_id = c.id and n.tipo = 'implantacao' and n.status <> 'cancelada') as tem_implantacao_ativa
       from cliente_prefeitura c
       order by c.nome`,
      [],
      executor
    ),
    query<LinhaNotaPainel>(
      `select id, cliente_id, tipo, valor, competencia, status, data_emissao, data_atesto, data_limite_pagamento, data_pagamento
       from nota_fiscal
       where status <> 'cancelada'
         and (
           (data_pagamento is null and status <> 'paga')
           or competencia >= $1::date
           or data_pagamento >= $1::date
         )`,
      [inicioJanela],
      executor
    )
  ]);
  return { clientes, notas };
}

/** Painel completo na data de hoje em America/Sao_Paulo. `agora` só é parâmetro pra teste. */
export async function obterPainelFinanceiro(agora: Date = new Date(), executor?: Executor): Promise<PainelFinanceiro> {
  const hoje = hojeEmSaoPaulo(agora);
  const inicioJanela = `${mesesDaJanela(hoje)[0]}-01`;
  const { clientes, notas } = await lerDadosPainel(inicioJanela, executor);
  return montarPainelFinanceiro({ clientes, notas, hoje });
}
