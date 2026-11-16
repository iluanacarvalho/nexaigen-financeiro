// Cancelamento de contrato vindo do nexaigen-educa (rodada 12-A): o Educa
// registra o ofício de cancelamento, a retratação ou o encerramento do
// município, e o Financeiro aplica no cliente_prefeitura vinculado
// (municipio_id_externo — o mesmo id da integração de cadastro).
//
// PROTEGIDA SÓ POR INTEGRACAO_SECRET (lib/autenticacaoIntegracao.ts — a
// mesma barreira de POST /api/integracao/clientes: rate limit por IP,
// Bearer em tempo constante, falhas de autenticação limitadas), nunca por
// sessão de equipe (app/api/protecao-rotas.test.ts confere).
//
// POST { acao: 'registrar', dataPedido, motivo? }
//      { acao: 'retratar', motivo? }
//      { acao: 'encerrar', imediato?, motivo? }
//   → 200 { clienteId, statusContrato, pedidoEm, terminoEm, mudou }
//   IDEMPOTENTE: repetir a mesma ação (mesmo dataPedido já registrado,
//   retratação já feita, contrato já encerrado) devolve 200 com
//   mudou: false e NÃO grava evento novo — retry do Educa é seguro.
//   400 dado inválido · 404 município sem cliente no Financeiro ·
//   409 transição inválida (ex.: retratar depois do término, registrar com
//   outra data enquanto já há aviso prévio, encerrar antes do término sem
//   imediato) · 500 falha de banco (+ alerta de sistema).
// Regras: lib/cancelamentoContrato.ts; escrita: lib/cancelamentoServico.ts.

import { NextRequest, NextResponse } from "next/server";
import { CATEGORIA_ALERTA_INTEGRACAO, autorizarIntegracao } from "@/lib/autenticacaoIntegracao";
import { alertarErroSistema } from "@/lib/alertaErroSistema";
import { CancelamentoIntegracaoSchema } from "@/lib/cancelamentoSchemas";
import {
  clientePorMunicipio,
  encerrarContrato,
  registrarCancelamento,
  retratarCancelamento,
  type AutorContrato,
  type ResultadoContrato
} from "@/lib/cancelamentoServico";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

const MUNICIPIO_SEM_CLIENTE =
  "Nenhum cliente do Financeiro está vinculado a este município (municipioIdExterno). Envie o cadastro antes por POST /api/integracao/clientes.";

const AUTOR_EDUCA: AutorContrato = { origem: "educa", equipeId: null };

export async function POST(req: NextRequest, { params }: { params: Promise<{ municipioIdExterno: string }> }) {
  const negado = await autorizarIntegracao(req);
  if (negado) return negado;

  const { municipioIdExterno } = await params;
  const parsed = CancelamentoIntegracaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const corpo = parsed.data;
  if (!ehUuid(municipioIdExterno)) return NextResponse.json({ erro: MUNICIPIO_SEM_CLIENTE }, { status: 404 });

  const hoje = hojeEmSaoPaulo(new Date());
  const motivo = corpo.motivo ? corpo.motivo : null;

  let r: ResultadoContrato;
  try {
    const clienteId = await clientePorMunicipio(municipioIdExterno);
    if (!clienteId) return NextResponse.json({ erro: MUNICIPIO_SEM_CLIENTE }, { status: 404 });
    switch (corpo.acao) {
      case "registrar":
        r = await registrarCancelamento(clienteId, { dataPedido: corpo.dataPedido!, motivo }, AUTOR_EDUCA, hoje);
        break;
      case "retratar":
        r = await retratarCancelamento(clienteId, AUTOR_EDUCA, hoje);
        break;
      case "encerrar":
        r = await encerrarContrato(clienteId, { imediato: corpo.imediato === true, motivo }, AUTOR_EDUCA, hoje);
        break;
    }
  } catch (erro) {
    // Nunca o erro cru (pode ecoar valores da linha) — só o código do pg.
    const codigo = (erro as { code?: string } | null)?.code ?? "desconhecido";
    console.error(`[integracao-educa] falha ao aplicar cancelamento de contrato — código pg: ${codigo}.`);
    await alertarErroSistema(
      CATEGORIA_ALERTA_INTEGRACAO,
      `Falha ao aplicar cancelamento de contrato vindo do nexaigen-educa (ação ${corpo.acao}, código pg: ${codigo}).`
    );
    return NextResponse.json({ erro: "Falha ao gravar o cancelamento — tente novamente em instantes." }, { status: 500 });
  }

  if (r.ok) {
    const { clienteId, statusContrato, pedidoEm, terminoEm, mudou } = r;
    return NextResponse.json({ clienteId, statusContrato, pedidoEm, terminoEm, mudou });
  }
  switch (r.motivo) {
    case "nao_encontrado":
      return NextResponse.json({ erro: MUNICIPIO_SEM_CLIENTE }, { status: 404 });
    case "dados_invalidos":
      return NextResponse.json({ erro: "Dados inválidos", detalhes: { formErrors: [], fieldErrors: { dataPedido: [r.erro] } } }, { status: 400 });
    case "transicao_invalida":
      return NextResponse.json({ erro: r.erro }, { status: 409 });
  }
}
