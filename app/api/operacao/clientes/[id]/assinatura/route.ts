// REGISTRO DA ASSINATURA do contrato (rodada 16-B1) — tarefa de Contratos.
// Área "operacao", e só os papéis Contratos e admin (Implantação → 404).
// POST multipart { data_assinatura (aaaa-mm-dd, não futura), arquivo (PDF ≤10MB, %PDF-) }
//   → 200 { versao_contrato, tarefa_implantacao_id }
// O PDF entra PRIMEIRO pelo armazenamento versionado de sempre (bucket fora
// do ar → 502 com a mesma mensagem, NADA muda). Só com o PDF aceito, numa
// transação: cliente 'ativo' com data_inicio_contrato = data da assinatura,
// evento, tarefa de assinatura concluída, tarefa de implantação aberta.
// 409: já assinado / sem tarefa de assinatura aberta.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { registrarAssinatura } from "@/lib/fechamentoServico";
import { dataIso } from "@/lib/fechamentoSchemas";
import { respostaDeFalhaFechamento } from "@/lib/fechamentoHttp";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { lerPdfDoFormData } from "@/lib/validacaoPdf";
import { ehUuid } from "@/lib/validacao";

const NAO_ENCONTRADO = "Cliente não encontrado.";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "operacao");
  if (negado) return negado;

  const { id } = await params;
  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ erro: "Corpo da requisição precisa ser multipart/form-data." }, { status: 400 });
  const data = dataIso.safeParse(String(formData.get("data_assinatura") ?? ""));
  if (!data.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: { formErrors: [], fieldErrors: { data_assinatura: ["Informe a data da assinatura (aaaa-mm-dd)."] } } }, { status: 400 });
  }
  const pdf = await lerPdfDoFormData(formData);
  if (!pdf.ok) return NextResponse.json({ erro: pdf.erro }, { status: 400 });
  if (!ehUuid(id)) return NextResponse.json({ erro: NAO_ENCONTRADO }, { status: 404 });

  const r = await registrarAssinatura(id, { dataAssinatura: data.data, pdf: { buffer: pdf.buffer, nome: pdf.nome } }, { equipeId: contexto!.equipeId, papel: contexto!.papel }, hojeEmSaoPaulo(new Date()));
  if (!r.ok) return respostaDeFalhaFechamento(r, NAO_ENCONTRADO);
  return NextResponse.json({ versao_contrato: r.versaoContrato, tarefa_implantacao_id: r.tarefaImplantacaoId });
}
