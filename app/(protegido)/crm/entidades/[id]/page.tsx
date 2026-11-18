// Tela da entidade (rodada 16-A2). Server Component: a entidade e as linhas
// dos membros (lib/territorioRepositorio.ts#obterEntidade), filtradas pela
// MESMA consulta do Território (lib/territorioConsulta.ts). Entidade
// inexistente, desativada (vendas) ou de estado não liberado (vendas) → 404.
// Admin: editar a entidade e os membros. Área "crm" checada no layout.

import { notFound, redirect } from "next/navigation";
import { contextoDaPagina } from "@/lib/authPagina";
import { escopoDe } from "@/lib/crmHttp";
import { listarVendedores } from "@/lib/crmRepositorio";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { consultarTerritorio } from "@/lib/territorioConsulta";
import { obterEntidade } from "@/lib/territorioRepositorio";
import { PARAMETROS_POR_TELA } from "@/lib/territorio";
import { ehUuid } from "@/lib/validacao";
import FormEntidade from "../FormEntidade";
import MembrosAdmin from "./MembrosAdmin";
import TelaEntidade from "./TelaEntidade";

export default async function EntidadePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ [chave: string]: string | string[] | undefined }> }) {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  const { id } = await params;
  if (!ehUuid(id)) notFound();
  const leitor = escopoDe(contexto);
  const hoje = hojeEmSaoPaulo(new Date());
  const dados = await obterEntidade(id, leitor, hoje);
  if (!dados) notFound();
  const r = await consultarTerritorio(await searchParams, leitor, hoje, { entidadeId: id, linhas: dados.linhas });
  const vendedores = leitor.admin ? await listarVendedores() : [];
  const microrregioes = [...new Set(dados.linhas.map((l) => l.microrregiao).filter((m): m is string => m !== null))].sort();

  return (
    <>
      <TelaEntidade
        entidade={dados.entidade}
        todosMembros={dados.linhas}
        hoje={hoje}
        tabela={{ filtros: r.filtros, avisos: r.avisos, linhas: r.pagina, total: r.total, resumo: r.resumo, admin: leitor.admin, vendedores, microrregioes, entidades: [], parametrosVisao: PARAMETROS_POR_TELA.entidade }}
      />
      {leitor.admin && (
        <section aria-label="Administração da entidade" className="mx-auto max-w-7xl px-4 pb-10">
          <details className="rounded-lg border bg-white p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-navy">Editar dados da entidade</summary>
            <div className="mt-2">
              <FormEntidade inicial={dados.entidade} hoje={hoje} />
            </div>
          </details>
          <MembrosAdmin entidadeId={id} membros={dados.linhas.map((l) => ({ codigo_ibge: l.codigo_ibge, nome: l.nome, uf: l.uf }))} />
        </section>
      )}
    </>
  );
}
