// Exige sessão (lib/auth.ts#exigirSessao) desde a rodada de correção do
// achado crítico de segurança — esta rota (dado de cliente real: CNPJ,
// valor mensal, contato) chegou a ficar completamente aberta. Postgres
// direto via lib/db.ts desde a rodada de migração de infraestrutura
// (Supabase → pg, mesma arquitetura do nexaigen-educa) — mesmo
// comportamento de antes, só troca COMO o dado é lido/escrito.
//
// Planos (rodada 11-A): plano obrigatório (lib/planos.ts); valor_mensal e
// taxa_implantacao vêm como TEXTO e, se ausentes, assumem o padrão do
// plano (só na criação — lib/clienteSchema.ts). Dispensa nunca tem taxa.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { ClienteSchema } from "@/lib/clienteSchema";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import { detalhesDoErro } from "@/lib/validacao";
import { centavosParaNumeric } from "@/lib/dinheiro";

export async function GET(req: NextRequest) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  // contrato_versao_atual: número da versão pra qual contrato_arquivo_chave aponta (0009) — lookup pela chave única.
  // tem_implantacao_ativa (0010): já existe nota de implantação não cancelada — é o que tira o selo "Implantação a cobrar".
  const clientes = await query(
    `select c.*,
       (select v.versao from cliente_contrato_versao v where v.chave = c.contrato_arquivo_chave) as contrato_versao_atual,
       exists (select 1 from nota_fiscal n where n.cliente_id = c.id and n.tipo = 'implantacao' and n.status <> 'cancelada') as tem_implantacao_ativa
     from cliente_prefeitura c order by c.nome`
  );
  return NextResponse.json({ clientes });
}

export async function POST(req: NextRequest) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const parsed = ClienteSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const c = parsed.data;

  const linhas = await query<{ id: string }>(
    `insert into cliente_prefeitura
       (nome, uf, cnpj, plano, valor_mensal, dia_vencimento_contrato, data_inicio_contrato,
        sistema_portal, portal_url, portal_usuario, contato_nome, contato_email, contato_telefone, observacao, taxa_implantacao)
     values ($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::numeric)
     returning id`,
    [
      c.nome,
      c.uf,
      c.cnpj ?? null,
      c.plano,
      // Centavos (já com o padrão do plano se não veio — lib/clienteSchema.ts) → numeric, sem float.
      centavosParaNumeric(c.valor_mensal),
      c.dia_vencimento_contrato,
      c.data_inicio_contrato,
      c.sistema_portal ?? null,
      c.portal_url ?? null,
      c.portal_usuario ?? null,
      c.contato_nome ?? null,
      c.contato_email ?? null,
      c.contato_telefone ?? null,
      c.observacao ?? null,
      c.taxa_implantacao === null ? null : centavosParaNumeric(c.taxa_implantacao)
    ]
  );
  return NextResponse.json({ id: linhas[0].id });
}
