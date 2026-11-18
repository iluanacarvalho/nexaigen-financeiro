// Uma entidade intermunicipal (rodada 16-A2).
// GET   — área "crm": a entidade + os membros com o status de cada um (mesma
//         tabela/filtros do Território, na query string) + "X de Y já são
//         clientes". Entidade inexistente, desativada (pra vendas) ou de
//         estado não liberado (pra vendas) → 404.
// PATCH — SÓ ADMIN ("crm_gestao"): edita qualquer campo; { ativo: false } =
//         "remover" sem apagar (visões salvas que apontam pra ela passam a
//         ignorar o filtro com aviso).

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { escopoDe } from "@/lib/crmHttp";
import { EditarEntidadeSchema } from "@/lib/entidadeSchemas";
import { editarEntidade } from "@/lib/entidadesServico";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { POR_PAGINA_TERRITORIO, montarQueryTerritorio, resumirLinhas } from "@/lib/territorio";
import { consultarTerritorio } from "@/lib/territorioConsulta";
import { obterEntidade } from "@/lib/territorioRepositorio";
import { ENTIDADE_NAO_ENCONTRADA, respostaDeFalhaSimples } from "@/lib/territorioHttp";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm");
  if (negado) return negado;

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ erro: ENTIDADE_NAO_ENCONTRADA }, { status: 404 });
  const leitor = escopoDe(contexto!);
  const hoje = hojeEmSaoPaulo(new Date());
  const dados = await obterEntidade(id, leitor, hoje);
  if (!dados) return NextResponse.json({ erro: ENTIDADE_NAO_ENCONTRADA }, { status: 404 });
  const r = await consultarTerritorio(req.nextUrl.searchParams, leitor, hoje, { entidadeId: id, linhas: dados.linhas });
  const todos = resumirLinhas(dados.linhas);
  return NextResponse.json(
    {
      entidade: dados.entidade,
      membros: { total: todos.total, clientes: todos.clientes },
      ja_fecharam: dados.linhas.filter((l) => l.status === "cliente").map((l) => ({ codigo_ibge: l.codigo_ibge, nome: l.nome, uf: l.uf, plano: l.contrato!.plano, desde: l.contrato!.desde })),
      filtros: montarQueryTerritorio(r.filtros),
      avisos: r.avisos,
      total: r.total,
      resumo: r.resumo,
      linhas: r.pagina,
      pagina: r.filtros.pagina,
      por_pagina: POR_PAGINA_TERRITORIO
    },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm_gestao");
  if (negado) return negado;

  const { id } = await params;
  const parsed = EditarEntidadeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: ENTIDADE_NAO_ENCONTRADA }, { status: 404 });
  const r = await editarEntidade(id, parsed.data, hojeEmSaoPaulo(new Date()));
  return r.ok ? NextResponse.json({ ok: true }) : respostaDeFalhaSimples(r, ENTIDADE_NAO_ENCONTRADA);
}
