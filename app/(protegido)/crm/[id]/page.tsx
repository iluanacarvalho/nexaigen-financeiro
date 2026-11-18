// CRM — detalhe do lead (rodada 16-A). Lê NO ESCOPO de quem pede
// (lib/crmRepositorio.ts#obterLead): lead de colega, pra vendas, "não
// existe" → página 404 (mesma resposta da API — nunca 403, pra não deixar
// enumerar leads). A área "crm" já foi checada no layout.tsx da pasta pai.

import { notFound, redirect } from "next/navigation";
import { contextoDaPagina } from "@/lib/authPagina";
import { escopoDe } from "@/lib/crmHttp";
import { listarVendedores, obterLead } from "@/lib/crmRepositorio";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { ehUuid } from "@/lib/validacao";
import DetalheLead from "./DetalheLead";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  const { id } = await params;
  if (!ehUuid(id)) notFound();
  const escopo = escopoDe(contexto);
  const lead = await obterLead(id, escopo, hojeEmSaoPaulo(new Date()));
  if (!lead) notFound();
  const { historico, ...dados } = lead;
  return <DetalheLead lead={dados} historico={historico} admin={escopo.admin} vendedores={escopo.admin ? await listarVendedores() : []} />;
}
