// Integração nexaigen-educa → Financeiro: dados da IMPLANTAÇÃO (rodada
// 16-B1; consumido pela 16-B2 pra pré-preencher o assistente do Educa).
// PROTEGIDA SÓ POR INTEGRACAO_SECRET (Bearer, tempo constante, rate limit —
// lib/autenticacaoIntegracao.ts, a mesma barreira das outras rotas de
// integração), nunca por sessão de equipe. Sem cache.
// GET /api/integracao/implantacoes/<municipioIdExterno (uuid) OU codigoIbge (7 dígitos)>
//   → 200 { nome, uf, codigo_ibge, plano, contato: { nome, cargo, email, telefone }, data_assinatura, status }
//   400 chave inválida · 404 sem cliente · 409 cliente ainda aguardando assinatura
//   (a implantação só começa depois da assinatura). NADA financeiro, nada de
//   CNPJ, endereço ou representante.

import { NextRequest, NextResponse } from "next/server";
import { autorizarIntegracao } from "@/lib/autenticacaoIntegracao";
import { dadosParaImplantacao } from "@/lib/implantacaoIntegracao";

const SEM_CACHE = { "cache-control": "no-store" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ chave: string }> }) {
  const negado = await autorizarIntegracao(req);
  if (negado) return negado;

  const { chave } = await params;
  const r = await dadosParaImplantacao(String(chave ?? ""));
  if (r.ok) return NextResponse.json(r.dados, { headers: SEM_CACHE });
  if (r.motivo === "chave_invalida") return NextResponse.json({ erro: "Use o id do município no Educa (uuid) ou o código IBGE (7 dígitos)." }, { status: 400, headers: SEM_CACHE });
  if (r.motivo === "nao_encontrado") return NextResponse.json({ erro: "Nenhum cliente para este município." }, { status: 404, headers: SEM_CACHE });
  return NextResponse.json({ erro: "O cliente ainda aguarda a assinatura do contrato — a implantação só começa depois dela." }, { status: 409, headers: SEM_CACHE });
}
