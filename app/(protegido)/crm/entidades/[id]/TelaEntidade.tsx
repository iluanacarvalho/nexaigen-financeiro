// Tela da ENTIDADE (rodada 16-A2) — a principal do comercial: quem é a
// entidade (com fonte e data da verificação), o cabeçalho GRANDE "X de Y
// prefeituras já são clientes da NEXAIGEN", a faixa "JÁ FECHARAM CONOSCO",
// a ação de destaque (abrir leads de todas as ainda não abordadas, com
// prévia) e a lista completa dos membros (a mesma tabela do Território).

import { ROTULO_TIPO_ENTIDADE, verificacaoAntiga, type TipoEntidade } from "@/lib/entidades";
import { rotuloDoPlano } from "@/lib/planos";
import { textoClientesDaEntidade, type LinhaTerritorio } from "@/lib/territorio";
import type { EntidadeDetalhe } from "@/lib/territorioRepositorio";
import LoteLeads from "../../territorio/LoteLeads";
import TabelaTerritorio, { type PropsTabelaTerritorio } from "../../territorio/TabelaTerritorio";

const dataBr = (dia: string) => dia.split("-").reverse().join("/");

export default function TelaEntidade({
  entidade,
  todosMembros,
  hoje,
  tabela
}: {
  entidade: EntidadeDetalhe;
  /** TODOS os membros visíveis (sem filtro) — base do "X de Y" e da faixa. */
  todosMembros: LinhaTerritorio[];
  hoje: string;
  tabela: Omit<PropsTabelaTerritorio, "tela" | "base" | "entidadeId">;
}) {
  const clientes = todosMembros.filter((l) => l.status === "cliente");
  const naoAbordados = todosMembros.filter((l) => l.status === "nao_abordado").length;
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      {!entidade.ativo && <p className="mb-3 rounded bg-slate-200 p-2 text-sm text-slate-800">Esta entidade está desativada — não aparece para a equipe de vendas.</p>}
      <header className="mb-4">
        <p className="text-xs uppercase tracking-wide text-violet-800">{ROTULO_TIPO_ENTIDADE[entidade.tipo as TipoEntidade] ?? entidade.tipo}{entidade.uf ? ` · ${entidade.uf}` : ""}</p>
        <h1 className="text-2xl font-bold text-navy">
          {entidade.nome}
          {entidade.sigla && <span className="ml-2 text-lg font-normal text-slate-600">({entidade.sigla})</span>}
        </h1>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
          {entidade.site && (
            <div>
              <dt className="inline font-medium">Site: </dt>
              <dd className="inline">
                <a href={entidade.site} target="_blank" rel="noopener noreferrer" className="text-navy underline">
                  {entidade.site}
                </a>
              </dd>
            </div>
          )}
          {(entidade.contato_nome || entidade.contato_email || entidade.contato_telefone) && (
            <div>
              <dt className="inline font-medium">Contato: </dt>
              <dd className="inline">{[entidade.contato_nome, entidade.contato_email, entidade.contato_telefone].filter(Boolean).join(" · ")}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-medium">Fonte: </dt>
            <dd className="inline">
              <a href={entidade.fonte_url} target="_blank" rel="noopener noreferrer" className="text-navy underline">
                {entidade.fonte_url}
              </a>
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Última verificação: </dt>
            <dd className="inline">
              {dataBr(entidade.verificado_em)}
              {verificacaoAntiga(entidade.verificado_em, hoje) && (
                <span className="ml-2 text-amber-700" data-testid="aviso-verificacao">
                  (mais de 12 meses — confira a fonte de novo)
                </span>
              )}
            </dd>
          </div>
          {entidade.observacao && <p className="sm:col-span-2">{entidade.observacao}</p>}
        </dl>
      </header>

      <section aria-label="Clientes da entidade" className="mb-4 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-5">
        <p className="text-3xl font-extrabold text-emerald-900" data-testid="x-de-y">
          {textoClientesDaEntidade(clientes.length, todosMembros.length)}
        </p>
        {clientes.length > 0 && (
          <div className="mt-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-emerald-900">Já fecharam conosco</h2>
            <ul className="mt-1 flex flex-wrap gap-2" aria-label="Já fecharam conosco">
              {clientes.map((l) => (
                <li key={l.codigo_ibge} className="rounded-lg border border-emerald-300 bg-white px-3 py-1 text-sm">
                  <span className="font-semibold">{l.nome}</span> · {rotuloDoPlano(l.contrato!.plano)} · desde {dataBr(l.contrato!.desde)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {todosMembros.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-slate-600">Nenhuma prefeitura cadastrada nesta entidade ainda.</p>
      ) : (
        <>
          <div className="mb-4">
            <LoteLeads
              rotulo={`Abrir leads de todas as prefeituras ainda não abordadas desta entidade (${naoAbordados})`}
              alvo={{ modo: "nao_abordados", filtros: {}, entidade_id: entidade.id }}
              admin={tabela.admin}
              vendedores={tabela.vendedores}
              destaque
              desabilitado={naoAbordados === 0}
            />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-navy">Todas as prefeituras da entidade</h2>
          <TabelaTerritorio tela="entidade" base={`/crm/entidades/${entidade.id}`} entidadeId={entidade.id} {...tabela} />
        </>
      )}
    </main>
  );
}
