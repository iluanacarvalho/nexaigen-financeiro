// CRM — detalhe do lead (rodada 16-A). Lê NO ESCOPO de quem pede
// (lib/crmRepositorio.ts#obterLead): lead de colega, pra vendas, "não
// existe" → página 404 (mesma resposta da API — nunca 403, pra não deixar
// enumerar leads). A área "crm" já foi checada no layout.tsx da pasta pai.

import { notFound, redirect } from "next/navigation";
import { contextoDaPagina } from "@/lib/authPagina";
import { escopoDe } from "@/lib/crmHttp";
import { listarVendedores, obterLead } from "@/lib/crmRepositorio";
import { etiquetasPorMunicipio, ufsLiberadas } from "@/lib/territorioRepositorio";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { ehUuid } from "@/lib/validacao";
import DetalheLead from "./DetalheLead";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  const { id } = await params;
  if (!ehUuid(id)) notFound();
  const escopo = escopoDe(contexto);
  const hoje = hojeEmSaoPaulo(new Date());
  const lead = await obterLead(id, escopo, hoje);
  if (!lead) notFound();
  const { historico, ...dados } = lead;
  // Etiquetas das entidades do município (rodada 16-A2) — SÓ pelo código IBGE do lead (16-A3). Sem código: a tela oferece "Vincular ao município".
  const codigo = dados.codigo_ibge;
  const [entidades, liberadas, vendedores] = await Promise.all([
    codigo ? etiquetasPorMunicipio([codigo], escopo, hoje).then((m) => m.get(codigo) ?? []) : Promise.resolve([]),
    ufsLiberadas(),
    escopo.admin ? listarVendedores() : Promise.resolve([])
  ]);
  return <DetalheLead lead={dados} historico={historico} admin={escopo.admin} vendedores={vendedores} entidades={entidades} ufsLiberadas={liberadas} />;
}
