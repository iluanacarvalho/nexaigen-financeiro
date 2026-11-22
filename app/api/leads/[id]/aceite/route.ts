// CRM — REGISTRAR O ACEITE da prefeitura (rodada 16-B1). Área "crm"; dono do
// lead ou admin (lead de colega → 404, como todo o CRM).
// POST { versao, plano, valor_mensal (texto), taxa_implantacao (texto|null),
//        data_prevista_assinatura?, cnpj, endereco_logradouro, endereco_numero,
//        endereco_complemento?, endereco_bairro, endereco_cep,
//        representante_nome, representante_cargo, contato_nome, contato_cargo,
//        contato_email, contato_telefone }
//   → 201 { cliente_id, tarefa_id, reaproveitou_ex_cliente }
// UMA transação (lib/fechamentoServico.ts#registrarAceite): lead → 'ganho',
// cliente em 'aguardando_assinatura' (sem cobrança), evento e tarefa de
// Contratos. 409: aceite repetido, cliente vigente do município, lead sem
// município da base, versão velha. É o ÚNICO caminho que grava 'ganho'.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { LEAD_NAO_ENCONTRADO, escopoDe } from "@/lib/crmHttp";
import { AceiteSchema } from "@/lib/fechamentoSchemas";
import { registrarAceite } from "@/lib/fechamentoServico";
import { respostaDeFalhaFechamento } from "@/lib/fechamentoHttp";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const { id } = await params;
  const parsed = AceiteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: LEAD_NAO_ENCONTRADO }, { status: 404 });
  const r = await registrarAceite(id, parsed.data, escopoDe(contexto!), hojeEmSaoPaulo(new Date()));
  if (!r.ok) return respostaDeFalhaFechamento(r, LEAD_NAO_ENCONTRADO);
  return NextResponse.json({ cliente_id: r.clienteId, tarefa_id: r.tarefaId, reaproveitou_ex_cliente: r.reaproveitouExCliente }, { status: 201 });
}
