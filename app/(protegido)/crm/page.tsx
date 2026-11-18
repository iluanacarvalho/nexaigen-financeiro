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
import { PARAMETROS_POR_TELA } from "@/lib/territorio";
import { entidadesAtivasVisiveis, opcoesDeEntidade } from "@/lib/territorioRepositorio";
import PainelCrm from "./PainelCrm";

export default async function CrmPage({ searchParams }: { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> }) {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  const escopo = escopoDe(contexto);
  const hoje = hojeEmSaoPaulo(new Date());
  const busca = await searchParams;
  const etapaInicial = typeof busca.etapa === "string" && (ETAPAS as readonly string[]).includes(busca.etapa) ? (busca.etapa as Etapa) : undefined;
  const visaoInicial = busca.visao === "lista" ? "lista" : "funil";
  // Filtros da lista na URL (rodada 16-A2): só os parâmetros da tela; entidade removida/não visível é ignorada com aviso.
  const params = new URLSearchParams();
  for (const chave of PARAMETROS_POR_TELA.leads) {
    const valor = busca[chave];
    if (typeof valor === "string" && valor.trim() !== "") params.set(chave, valor.trim().slice(0, 200));
  }
  const avisos: string[] = [];
  const entidadeFiltro = params.get("entidade");
  if (entidadeFiltro && !(/^[0-9a-f-]{36}$/i.test(entidadeFiltro) && (await entidadesAtivasVisiveis([entidadeFiltro], escopo)).has(entidadeFiltro))) {
    params.delete("entidade");
    avisos.push("A entidade deste filtro não existe mais (ou foi desativada) — filtro ignorado.");
  }
  if (params.get("vendedor_id") && !escopo.admin) params.delete("vendedor_id");
  const [resumo, funil, vendedores, entidades] = await Promise.all([
    obterResumoCrm(escopo, hoje),
    listarFunil(escopo, hoje),
    escopo.admin ? listarVendedores() : Promise.resolve([]),
    opcoesDeEntidade(escopo)
  ]);
  return (
    <PainelCrm
      resumo={resumo}
      funil={funil}
      admin={escopo.admin}
      vendedores={vendedores}
      visaoInicial={visaoInicial}
      etapaInicial={etapaInicial}
      queryInicial={params.toString()}
      entidades={entidades}
      avisos={avisos}
    />
  );
}
