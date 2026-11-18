// Membros de uma entidade intermunicipal (rodada 16-A2). SÓ ADMIN (área
// "crm_gestao").
// POST   { codigo_ibge, desde? } → 201 · município fora da base → 400 ·
//        já é membro → 409 · entidade inexistente → 404
// DELETE { codigo_ibge } → 200 · não era membro → 404
// (Um município pode estar em várias entidades.)

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { MembroSchema, RemoverMembroSchema } from "@/lib/entidadeSchemas";
import { adicionarMembro, removerMembro } from "@/lib/entidadesServico";
import { ENTIDADE_NAO_ENCONTRADA, respostaDeFalhaSimples } from "@/lib/territorioHttp";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm_gestao");
  if (negado) return negado;

  const { id } = await params;
  const parsed = MembroSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: ENTIDADE_NAO_ENCONTRADA }, { status: 404 });
  const r = await adicionarMembro(id, parsed.data.codigo_ibge, parsed.data.desde ?? null);
  return r.ok ? NextResponse.json({ ok: true }, { status: 201 }) : respostaDeFalhaSimples(r, ENTIDADE_NAO_ENCONTRADA);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm_gestao");
  if (negado) return negado;

  const { id } = await params;
  const parsed = RemoverMembroSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: "Membro não encontrado." }, { status: 404 });
  const r = await removerMembro(id, parsed.data.codigo_ibge);
  return r.ok ? NextResponse.json({ ok: true }) : respostaDeFalhaSimples(r, "Membro não encontrado.");
}
