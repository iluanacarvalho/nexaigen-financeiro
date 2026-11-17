// Notas fiscais — listagem (filtros, busca, ordenação e paginação NO
// SERVIDOR) e criação. Exige sessão da equipe (exigirPapel). Regras em
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
//      Aviso prévio (rodada 12-A): contrato 'em_aviso_previo' aceita nota
//      normalmente; 'encerrado' por aviso prévio ainda aceita a mensalidade
//      do último período (nota final); mensalidade de período que começa
//      depois do término → 409 (lib/cancelamentoContrato.ts).
//      O PDF, se houver, vai depois em POST /api/notas/[id]/arquivo (upload
//      versionado que já existe).
//      tipo (rodada 11-A): "mensalidade" (padrão) ou "implantacao" — cobrança
//      ÚNICA da taxa combinada do cliente: competência = mês da emissão,
//      409 se o cliente não tem taxa ou já tem implantação ativa. Mesma
//      máquina de estados e mesmos prazos (Lei 14.133, art. 141).

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { FiltrosNotasSchema, NovaNotaSchema } from "@/lib/notaSchemas";
import { criarNota, listarNotas, type FiltrosNotas } from "@/lib/notasServico";
import { lerValorMonetario, normalizarCompetencia, validarCompetencia, validarDataEmissao, type SituacaoNota } from "@/lib/estadoNota";
import { detalhesDoErro } from "@/lib/validacao";
import { formatarDataBr, rotuloStatusContrato } from "@/lib/cancelamentoContrato";

export async function GET(req: NextRequest) {
  const negado = exigirPapel(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value), "notas");
  if (negado) return negado;

  const parsed = FiltrosNotasSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ erro: "Filtros inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const f = parsed.data;

  const filtros: FiltrosNotas = {
    situacao: f.situacao as SituacaoNota | undefined,
    tipo: f.tipo,
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
  const negado = exigirPapel(contexto, "notas");
  if (negado) return negado;

  const parsed = NovaNotaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const n = parsed.data;
  const hoje = hojeEmSaoPaulo(new Date());

  const erros: Record<string, string[]> = {};
  const dataEmissao = n.data_emissao ?? hoje;
  const erroEmissao = validarDataEmissao(dataEmissao, hoje);
  if (erroEmissao) erros.data_emissao = [erroEmissao];

  // Implantação (cobrança única): competência é SEMPRE o mês da emissão — calculada aqui; se vier
  // outra, é erro (nunca "corrigida" em silêncio). Mensalidade: competência obrigatória, como sempre.
  let competencia: string | null = null;
  if (n.tipo === "implantacao") {
    competencia = erroEmissao ? null : `${dataEmissao.slice(0, 7)}-01`;
    if (competencia && n.competencia !== undefined && normalizarCompetencia(n.competencia) !== competencia) {
      erros.competencia = ["Na nota de implantação a competência é o mês da emissão — deixe em branco ou use o mesmo mês."];
    }
  } else if (n.competencia === undefined) {
    erros.competencia = ["Informe a competência (aaaa-mm)."];
  } else {
    competencia = normalizarCompetencia(n.competencia);
    if (!competencia) erros.competencia = ["Competência inválida — use aaaa-mm."];
    else {
      const erro = validarCompetencia(competencia, hoje);
      if (erro) erros.competencia = [erro];
    }
  }
  const valor = lerValorMonetario(n.valor);
  if (!valor.ok) erros.valor = [valor.erro];
  if (Object.keys(erros).length > 0 || !valor.ok || !competencia) {
    // Mesmo formato de `detalhes` das falhas de schema (lib/validacao.ts) — contrato da API.
    return NextResponse.json({ erro: "Dados inválidos", detalhes: { formErrors: [], fieldErrors: erros } }, { status: 400 });
  }

  const resultado = await criarNota(
    { clienteId: n.cliente_id, tipo: n.tipo, competencia, numeroNf: n.numero_nf ?? null, valorCentavos: valor.centavos, dataEmissao },
    contexto!.equipeId
  );
  if (resultado.ok) return NextResponse.json({ id: resultado.id }, { status: 201 });
  switch (resultado.motivo) {
    case "cliente_inexistente":
      return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });
    case "cliente_inativo":
      return NextResponse.json(
        { erro: `Este cliente está com o contrato ${rotuloStatusContrato(resultado.statusContrato).toLowerCase()} — só é possível lançar nota para cliente com contrato ativo ou em aviso prévio.` },
        { status: 409 }
      );
    case "competencia_apos_termino":
      return NextResponse.json(
        {
          erro: `O contrato termina em ${formatarDataBr(resultado.terminoEm)} (aviso prévio) — a última competência que pode ser cobrada é ${resultado.ultimaCompetencia.slice(5, 7)}/${resultado.ultimaCompetencia.slice(0, 4)}.`
        },
        { status: 409 }
      );
    case "numero_duplicado":
      return NextResponse.json({ erro: "Já existe uma nota com este número para este cliente." }, { status: 409 });
    case "implantacao_sem_taxa":
      return NextResponse.json(
        { erro: "Este cliente não tem taxa de implantação combinada (plano Dispensa ou taxa em branco) — não há implantação a cobrar." },
        { status: 409 }
      );
    case "implantacao_duplicada":
      return NextResponse.json(
        { erro: "Este cliente já tem uma nota de implantação ativa — a implantação é cobrada uma única vez (cancele a anterior, se ela foi emitida errada)." },
        { status: 409 }
      );
  }
}
