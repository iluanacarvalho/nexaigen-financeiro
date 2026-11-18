// Divulgação no mapa público (rodada 15-B) — tela de Clientes. Sessão +
// papel: área "clientes" (admin e financeiro, lib/papeis.ts). Autor de
// todo evento = a sessão, nunca o corpo.
//
// PUT { acao: "definir_codigo", codigoIbge: "4106902" | null }
//       Consulta o IBGE (lib/ibge.ts — SÓ aqui, nunca no endpoint público)
//       e grava código + posição. IBGE fora do ar → grava o código SEM
//       posição ("posição pendente"); código que o IBGE não conhece → 400.
//       Resposta: { codigoIbge, posicao, ibge, confere } — `confere` false =
//       nome/UF do cliente diferente do oficial (a tela avisa, não bloqueia).
//     { acao: "autorizar" } — exige código e posição.
//     { acao: "revogar" }   — sai do mapa na hora (no banco).
// 400 dado inválido · 404 cliente inexistente · 409 transição inválida
// ou código IBGE já usado por outro cliente.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { autorizarDivulgacao, definirCodigoIbge, revogarDivulgacao, type ResultadoDivulgacao } from "@/lib/divulgacaoServico";
import { buscarMunicipioIbge, codigoIbgeValido, municipioConfere, ufDoCodigoIbge, type ResultadoIbge } from "@/lib/ibge";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

const DivulgacaoSchema = z.discriminatedUnion("acao", [
  z.strictObject({
    acao: z.literal("definir_codigo"),
    codigoIbge: z.string().trim().refine(codigoIbgeValido, { error: "O código IBGE do município tem exatamente 7 dígitos." }).nullable()
  }),
  z.strictObject({ acao: z.literal("autorizar") }),
  z.strictObject({ acao: z.literal("revogar") })
], { error: "acao inválida — use definir_codigo, autorizar ou revogar." });

function erroDoServico(r: Extract<ResultadoDivulgacao, { ok: false }>): NextResponse {
  return NextResponse.json({ erro: r.erro }, { status: r.motivo === "nao_encontrado" ? 404 : 409 });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "clientes");
  if (negado) return negado;

  const { id } = await params;
  const parsed = DivulgacaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });
  const hoje = hojeEmSaoPaulo(new Date());
  const corpo = parsed.data;

  if (corpo.acao === "autorizar" || corpo.acao === "revogar") {
    const r = corpo.acao === "autorizar" ? await autorizarDivulgacao(id, contexto!.equipeId, hoje) : await revogarDivulgacao(id, contexto!.equipeId, hoje);
    return r.ok ? NextResponse.json({ autorizado: corpo.acao === "autorizar" }) : erroDoServico(r);
  }

  const codigo = corpo.codigoIbge;
  // Rede ANTES da transação (nunca segurar a trava do cliente esperando o IBGE).
  const ibge: ResultadoIbge | null = codigo ? await buscarMunicipioIbge(codigo) : null;
  if (ibge?.status === "nao_encontrado") {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: { formErrors: [], fieldErrors: { codigoIbge: ["Este código não existe no IBGE — confira os 7 dígitos."] } } }, { status: 400 });
  }
  const posicao = ibge?.status === "ok" ? ibge.posicao : null;
  const r = await definirCodigoIbge(id, codigo, posicao);
  if (!r.ok) return erroDoServico(r);

  // Confere com o cadastro: com o IBGE no ar, nome e UF; fora do ar, ao menos a UF (os 2 primeiros dígitos do código).
  const confere = !codigo ? null : ibge?.status === "ok" ? municipioConfere(r, ibge) : ufDoCodigoIbge(codigo) === r.uf.trim().toUpperCase() ? null : false;
  return NextResponse.json({
    codigoIbge: codigo,
    posicao,
    ibge: ibge === null ? null : ibge.status === "ok" ? { status: "ok", nome: ibge.nome, uf: ibge.uf } : { status: "indisponivel", ufDoCodigo: ufDoCodigoIbge(codigo!) },
    confere
  });
}
