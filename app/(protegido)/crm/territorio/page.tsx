// Território comercial (rodada 16-A2): todas as prefeituras de um estado,
// com status comercial e plano efetivo (lib/territorio.ts), filtros na URL
// (link compartilhável), visões salvas, lote e exportação (admin). Server
// Component: lê direto (lib/territorioConsulta.ts — a mesma consulta da API
// e da exportação), no escopo de quem lê (vendas: só estados liberados;
// lead de colega = só vendedor e etapa). A área "crm" é checada no layout.

import Link from "next/link";
import { redirect } from "next/navigation";
import { contextoDaPagina } from "@/lib/authPagina";
import { escopoDe } from "@/lib/crmHttp";
import { listarVendedores } from "@/lib/crmRepositorio";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { consultarTerritorio } from "@/lib/territorioConsulta";
import { listarMicrorregioes, opcoesDeEntidade } from "@/lib/territorioRepositorio";
import { PARAMETROS_POR_TELA } from "@/lib/territorio";
import TabelaTerritorio from "./TabelaTerritorio";

export default async function TerritorioPage({ searchParams }: { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> }) {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  const leitor = escopoDe(contexto);
  const r = await consultarTerritorio(await searchParams, leitor, hojeEmSaoPaulo(new Date()));
  const [microrregioes, entidades, vendedores] = await Promise.all([
    r.uf ? listarMicrorregioes(r.uf) : Promise.resolve([]),
    opcoesDeEntidade(leitor, r.uf ?? undefined),
    leitor.admin ? listarVendedores() : Promise.resolve([])
  ]);
  const ufsDaTela = leitor.admin ? r.ufsVisiveis : r.ufsLiberadas;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-navy">Território{r.uf ? ` — ${r.uf}` : ""}</h1>
      <p className="mb-4 text-sm text-slate-600">Todas as prefeituras do estado e onde a NEXAIGEN já está. Filtre, salve a visão e abra leads direto daqui.</p>
      {r.uf === null ? (
        <div className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-slate-600">
          <p className="font-medium">Nenhum estado liberado para o comercial ainda.</p>
          <p className="mt-1">{leitor.admin ? "Libere um estado em Estados (o estado precisa ter a base de municípios carregada)." : "Peça a um administrador para liberar o seu estado."}</p>
          {leitor.admin && (
            <Link href="/crm/estados" className="mt-3 inline-block rounded bg-navy px-4 py-2 text-white">
              Ir para Estados
            </Link>
          )}
        </div>
      ) : r.carregadas === 0 && !r.filtros.entidade ? (
        <>
          {leitor.admin && <SeletorUf ufs={ufsDaTela} atual={r.uf} />}
          <div className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-slate-600">
            <p className="font-medium">A base de municípios de {r.uf} ainda não foi carregada.</p>
            <p className="mt-1">Quem cuida do sistema carrega com: npm run importar-municipios -- {r.uf}</p>
          </div>
        </>
      ) : (
        <TabelaTerritorio
          tela="territorio"
          base="/crm/territorio"
          filtros={r.filtros}
          avisos={r.avisos}
          linhas={r.pagina}
          total={r.total}
          resumo={r.resumo}
          admin={leitor.admin}
          vendedores={vendedores}
          ufs={ufsDaTela}
          microrregioes={microrregioes}
          entidades={entidades}
          parametrosVisao={PARAMETROS_POR_TELA.territorio}
        />
      )}
    </main>
  );
}

function SeletorUf({ ufs, atual }: { ufs: string[]; atual: string }) {
  return (
    <nav aria-label="Estados" className="mb-3 flex flex-wrap gap-1 text-sm">
      {ufs.map((uf) => (
        <a key={uf} href={`/crm/territorio?uf=${uf}`} aria-current={uf === atual ? "page" : undefined} className={`rounded px-2 py-0.5 ${uf === atual ? "bg-navy text-white" : "border border-slate-300"}`}>
          {uf}
        </a>
      ))}
    </nav>
  );
}
