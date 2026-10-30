// Notas fiscais — listagem (filtros, busca, ordenação e paginação NO
// SERVIDOR) e criação. Exige sessão da equipe (exigirSessao). Regras em
// lib/estadoNota.ts (puras) e lib/notasServico.ts (transações); esta rota
// só valida a forma (lib/notaSchemas.ts) e traduz o resultado em HTTP.
//
// GET  ?situacao=&cliente_id=&competencia=aaaa-mm&busca=&ordenar=&direcao=&pagina=&por_pagina=
//      → { notas, total, pagina, por_pagina }. `situacao` é a da data de
//      HOJE (mesma derivação do Painel/Dashboard), não a coluna gravada.
//      Uma query só (total via count(*) over()), sem N+1.
// POST { cliente_id, competencia, numero_nf?, valor (texto), data_emissao? }
//      → 201 { id }. 400 dado inválido · 404 cliente inexistente ·
//      409 cliente suspenso/encerrado ou número de NF repetido pro cliente.
//      O PDF, se houver, vai depois em POST /api/notas/[id]/arquivo (upload
//      versionado que já existe).

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { FiltrosNotasSchema, NovaNotaSchema } from "@/lib/notaSchemas";
import { criarNota, listarNotas, type FiltrosNotas } from "@/lib/notasServico";
import { lerValorMonetario, normalizarCompetencia, validarCompetencia, validarDataEmissao, type SituacaoNota } from "@/lib/estadoNota";
import { detalhesDoErro } from "@/lib/validacao";

export async function GET(req: NextRequest) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const parsed = FiltrosNotasSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ erro: "Filtros inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const f = parsed.data;

  const filtros: FiltrosNotas = {
    situacao: f.situacao as SituacaoNota | undefined,
    clienteId: f.cliente_id,
    competencia: f.competencia ? normalizarCompetencia(f.competencia)! : undefined,
    busca: f.busca,
    ordenar: f.ordenar,
    direcao: f.direcao,
    pagina: f.pagina,
    porPagina: f.por_pagina
  };
  const { notas, total } = await listarNotas(filtros, hojeEmSaoPaulo(new Date()));
  return NextResponse.json({ notas, total, pagina: f.pagina, por_pagina: f.por_pagina }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirSessao(contexto);
  if (negado) return negado;

  const parsed = NovaNotaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const n = parsed.data;
  const hoje = hojeEmSaoPaulo(new Date());

  const erros: Record<string, string> = {};
  const competencia = normalizarCompetencia(n.competencia);
  if (!competencia) erros.competencia = "Competência inválida — use aaaa-mm.";
  else {
    const erro = validarCompetencia(competencia, hoje);
    if (erro) erros.competencia = erro;
  }
  const valor = lerValorMonetario(n.valor);
  if (!valor.ok) erros.valor = valor.erro;
  const dataEmissao = n.data_emissao ?? hoje;
  const erroEmissao = validarDataEmissao(dataEmissao, hoje);
  if (erroEmissao) erros.data_emissao = erroEmissao;
  if (Object.keys(erros).length > 0 || !valor.ok || !competencia) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: { fieldErrors: erros } }, { status: 400 });
  }

  const resultado = await criarNota(
    { clienteId: n.cliente_id, competencia, numeroNf: n.numero_nf ?? null, valorCentavos: valor.centavos, dataEmissao },
    contexto!.equipeId
  );
  if (resultado.ok) return NextResponse.json({ id: resultado.id }, { status: 201 });
  switch (resultado.motivo) {
    case "cliente_inexistente":
      return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });
    case "cliente_inativo":
      return NextResponse.json(
        { erro: `Este cliente está com o contrato ${resultado.statusContrato} — só é possível lançar nota para cliente com contrato ativo.` },
        { status: 409 }
      );
    case "numero_duplicado":
      return NextResponse.json({ erro: "Já existe uma nota com este número para este cliente." }, { status: 409 });
  }
}
