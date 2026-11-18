// CRM — leads (rodada 16-A). Sessão + papel: área "crm" (admin e vendas;
// financeiro e rh → 403). Visibilidade NO SQL (lib/crmRepositorio.ts):
// admin vê todos; vendas só os leads em que é o vendedor.
//
// GET  ?etapa=&vendedor_id= (só admin)&uf=&origem=&busca=&parados=true&vencidas=true
//      &ordenar=&direcao=&pagina=&por_pagina= (máx. 100) → { leads, total, pagina, por_pagina }
// POST { municipio_nome, uf, origem, codigo_ibge?, populacao?, plano_interesse?,
//        valor_mensal_estimado? (texto), contato_*?, proxima_acao_em?,
//        proxima_acao_descricao?, vendedor_id? (só admin) } → 201 { id }
//      Plano sem valor → sugere a mensalidade padrão do plano (lib/planos.ts).
//      409: lead ABERTO do mesmo município (código IBGE ou nome+UF, sem
//      acento/caixa) — a mensagem revela SÓ vendedor e etapa — ou prefeitura
//      que já é cliente. Sempre na etapa 'novo'.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { FiltrosLeadsSchema, NovoLeadSchema } from "@/lib/crmSchemas";
import { listarLeads } from "@/lib/crmRepositorio";
import { criarLead } from "@/lib/crmServico";
import { escopoDe, respostaDeFalha } from "@/lib/crmHttp";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { detalhesDoErro } from "@/lib/validacao";

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const parsed = FiltrosLeadsSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ erro: "Filtros inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const f = parsed.data;
  const escopo = escopoDe(contexto!);
  if (f.vendedor_id && !escopo.admin) return NextResponse.json({ erro: "Só administrador filtra por vendedor." }, { status: 403 });

  const { leads, total } = await listarLeads(
    { etapa: f.etapa, vendedorId: f.vendedor_id, uf: f.uf, origem: f.origem, busca: f.busca, parados: f.parados, vencidas: f.vencidas, ordenar: f.ordenar, direcao: f.direcao, pagina: f.pagina, porPagina: f.por_pagina },
    escopo,
    hojeEmSaoPaulo(new Date())
  );
  return NextResponse.json({ leads, total, pagina: f.pagina, por_pagina: f.por_pagina }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const parsed = NovoLeadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const d = parsed.data;
  const r = await criarLead(
    {
      municipio_nome: d.municipio_nome,
      uf: d.uf,
      codigo_ibge: d.codigo_ibge ?? null,
      populacao: d.populacao ?? null,
      plano_interesse: d.plano_interesse ?? null,
      valor_mensal_estimado_centavos: d.valor_mensal_estimado,
      contato_nome: d.contato_nome ?? null,
      contato_cargo: d.contato_cargo ?? null,
      contato_email: d.contato_email ?? null,
      contato_telefone: d.contato_telefone ?? null,
      origem: d.origem,
      proxima_acao_em: d.proxima_acao_em ?? null,
      proxima_acao_descricao: d.proxima_acao_descricao ?? null,
      vendedor_id: d.vendedor_id
    },
    escopoDe(contexto!)
  );
  return r.ok ? NextResponse.json({ id: r.id }, { status: 201 }) : respostaDeFalha(r);
}
