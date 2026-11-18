// CRM — tela principal (rodada 16-A). Server Component lendo o repositório
// direto (mesmo padrão do Painel), NO ESCOPO de quem lê
// (lib/crmRepositorio.ts — vendas só os seus leads; admin todos). A área
// "crm" já foi checada no layout.tsx desta pasta.
//
// Funil SEM corte silencioso (rodada 16-A1): os totais de cada etapa vêm de
// agregação SQL (obterResumoCrm); cada coluna mostra até CARTOES_POR_ETAPA
// cartões (listarFunil) e, quando há mais, "Ver todos os N desta etapa" →
// /crm?visao=lista&etapa=<etapa> (a lista paginada já filtrada).

import { redirect } from "next/navigation";
import { contextoDaPagina } from "@/lib/authPagina";
import { ETAPAS, type Etapa } from "@/lib/crm";
import { escopoDe } from "@/lib/crmHttp";
import { listarFunil, listarVendedores, obterResumoCrm } from "@/lib/crmRepositorio";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import PainelCrm from "./PainelCrm";

export default async function CrmPage({ searchParams }: { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> }) {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  const escopo = escopoDe(contexto);
  const hoje = hojeEmSaoPaulo(new Date());
  const busca = await searchParams;
  const etapaInicial = typeof busca.etapa === "string" && (ETAPAS as readonly string[]).includes(busca.etapa) ? (busca.etapa as Etapa) : undefined;
  const visaoInicial = busca.visao === "lista" ? "lista" : "funil";
  const [resumo, funil, vendedores] = await Promise.all([obterResumoCrm(escopo, hoje), listarFunil(escopo, hoje), escopo.admin ? listarVendedores() : Promise.resolve([])]);
  return <PainelCrm resumo={resumo} funil={funil} admin={escopo.admin} vendedores={vendedores} visaoInicial={visaoInicial} etapaInicial={etapaInicial} />;
}
