// CRM — registrar o aceite da prefeitura (rodada 16-B1). Área "crm" (layout
// da pasta pai). Lê o lead NO ESCOPO de quem pede (lead de colega → 404),
// com o município da base e os padrões: plano = o de interesse do lead, senão
// o sugerido pela população; contato pré-preenchido do lead.

import { notFound, redirect } from "next/navigation";
import { contextoDaPagina } from "@/lib/authPagina";
import { etapaAberta } from "@/lib/crm";
import { escopoDe } from "@/lib/crmHttp";
import { obterLead } from "@/lib/crmRepositorio";
import { query } from "@/lib/db";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { ehIdPlano, planoSugeridoPorPopulacao } from "@/lib/planos";
import { ehUuid } from "@/lib/validacao";
import FormAceite, { type DadosIniciaisAceite } from "./FormAceite";

export default async function AceitePage({ params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  const { id } = await params;
  if (!ehUuid(id)) notFound();
  const lead = await obterLead(id, escopoDe(contexto), hojeEmSaoPaulo(new Date()));
  if (!lead) notFound();
  if (!etapaAberta(lead.etapa)) redirect(`/crm/${id}`);

  const [base] = lead.codigo_ibge ? await query<{ nome: string; uf: string; populacao: number | null }>(`select nome, uf, populacao from municipio_base where codigo_ibge = $1`, [lead.codigo_ibge]) : [];
  const populacao = base?.populacao ?? lead.populacao;
  const sugerido = planoSugeridoPorPopulacao(populacao);
  const inicial: DadosIniciaisAceite = {
    leadId: lead.id,
    versao: lead.versao,
    municipio: { nome: base?.nome ?? lead.municipio_nome, uf: base?.uf ?? lead.uf, codigo_ibge: lead.codigo_ibge, populacao },
    plano: lead.plano_interesse && ehIdPlano(lead.plano_interesse) ? lead.plano_interesse : (sugerido ?? "dispensa"),
    origemPlano: lead.plano_interesse && ehIdPlano(lead.plano_interesse) ? "interesse" : sugerido ? "populacao" : "padrao",
    contato: { nome: lead.contato_nome ?? "", cargo: lead.contato_cargo ?? "", email: lead.contato_email ?? "", telefone: lead.contato_telefone ?? "" }
  };
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-navy">Registrar aceite da prefeitura</h1>
      <p className="mb-4 text-sm text-slate-600">Só depois do aceite. A cobrança e a vigência começam na data da ASSINATURA do contrato — até lá o cliente fica &quot;aguardando assinatura&quot;, sem cobrança.</p>
      <FormAceite inicial={inicial} />
    </main>
  );
}
