// CRM — tela principal (rodada 16-A). Server Component lendo o repositório
// direto (mesmo padrão do Painel), NO ESCOPO de quem lê
// (lib/crmRepositorio.ts — vendas só os seus leads; admin todos). A área
// "crm" já foi checada no layout.tsx desta pasta.

import { redirect } from "next/navigation";
import { contextoDaPagina } from "@/lib/authPagina";
import { escopoDe } from "@/lib/crmHttp";
import { listarLeads, listarVendedores, obterResumoCrm } from "@/lib/crmRepositorio";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import PainelCrm from "./PainelCrm";

/** O funil mostra até isto de leads abertos (a lista, paginada, mostra todos). */
const LIMITE_FUNIL = 1000;

export default async function CrmPage() {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  const escopo = escopoDe(contexto);
  const hoje = hojeEmSaoPaulo(new Date());
  const base = { ordenar: "atualizado" as const, direcao: "desc" as const, pagina: 1 };
  const [resumo, abertos, perdidos, vendedores] = await Promise.all([
    obterResumoCrm(escopo, hoje),
    listarLeads({ ...base, somenteAbertos: true, porPagina: LIMITE_FUNIL }, escopo, hoje),
    listarLeads({ ...base, etapa: "perdido", porPagina: 100 }, escopo, hoje),
    escopo.admin ? listarVendedores() : Promise.resolve([])
  ]);
  return <PainelCrm resumo={resumo} abertos={abertos.leads} perdidos={perdidos.leads} admin={escopo.admin} vendedores={vendedores} />;
}
