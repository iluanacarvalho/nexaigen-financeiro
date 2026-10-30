// GET/PATCH de UM cliente_prefeitura — uso normal da equipe (sessão,
// exigirSessao), não da integração com o Educa. PATCH só atualiza os
// campos enviados (ClientePatchSchema — mesmas regras por campo do POST
// /api/clientes, todas opcionais). Os campos de vínculo/arquivo
// (municipio_id_externo, contrato_arquivo_*) ficam DE FORA de propósito:
// o schema é estrito (z.strictObject) e recusa esses nomes — contrato só muda via
// POST /api/clientes/[id]/contrato (que valida o PDF de verdade), e o
// vínculo com o Educa só via POST /api/integracao/clientes.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { ClientePatchSchema } from "@/lib/clienteSchema";
import { NOME_COOKIE_ACCESS, exigirSessao, obterContextoAutenticado } from "@/lib/auth";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

// Um id que não é uuid faria o Postgres lançar (22P02) — tratado como
// "não encontrado" antes de chegar no banco, nunca um 500.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });

  const linhas = await query(`select * from cliente_prefeitura where id = $1`, [id]);
  if (linhas.length === 0) return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });
  return NextResponse.json({ cliente: linhas[0] });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const negado = exigirSessao(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value));
  if (negado) return negado;

  const { id } = await params;
  if (!ehUuid(id)) return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });

  const parsed = ClientePatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });

  // Nomes de coluna vêm SÓ das chaves do schema (objeto estrito — nunca uma
  // chave arbitrária do cliente), os valores sempre como parâmetro.
  // observacao vazia limpa o campo (null) — é a única forma da UI apagar
  // uma observação já salva.
  const campos = Object.entries(parsed.data)
    .filter(([, valor]) => valor !== undefined)
    .map(([coluna, valor]) => [coluna, coluna === "observacao" && valor === "" ? null : valor] as const);

  const sets = campos.map(([coluna], i) => `${coluna} = $${i + 1}`).join(", ");
  const valores = campos.map(([, valor]) => valor);

  const linhas = await query<{ id: string }>(`update cliente_prefeitura set ${sets} where id = $${campos.length + 1} returning id`, [
    ...valores,
    id
  ]);
  if (linhas.length === 0) return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });
  return NextResponse.json({ id: linhas[0].id });
}
