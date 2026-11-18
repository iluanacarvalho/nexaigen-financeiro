// Exportar a lista FILTRADA do Território ou da tela de uma entidade
// (rodada 16-A2). SÓ ADMIN: área "crm_gestao". GET ?formato=csv|xlsx + os
// filtros da tela (+ entidade_tela=<id> pra exportar os membros de uma
// entidade). Mesmas linhas da tela (lib/territorioConsulta.ts), colunas fixas
// sem contato/valor/nota (lib/territorioExportacao.ts), fórmulas neutralizadas.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { escopoDe } from "@/lib/crmHttp";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { descreverFiltros } from "@/lib/territorio";
import { consultarTerritorio } from "@/lib/territorioConsulta";
import { TITULO_EXPORTACAO_TERRITORIO, gerarCsvTerritorio, gerarXlsxTerritorio } from "@/lib/territorioExportacao";
import { obterEntidade } from "@/lib/territorioRepositorio";
import { ExportarTerritorioFormatoSchema } from "@/lib/territorioSchemas";
import { ENTIDADE_NAO_ENCONTRADA, parametrosDaUrl } from "@/lib/territorioHttp";
import { detalhesDoErro, ehUuid } from "@/lib/validacao";
import { TIPO_MIME_XLSX } from "@/lib/xlsx";

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm_gestao");
  if (negado) return negado;

  const params = req.nextUrl.searchParams;
  const formato = ExportarTerritorioFormatoSchema.safeParse(params.get("formato"));
  if (!formato.success) return NextResponse.json({ erro: "Filtros inválidos", detalhes: detalhesDoErro(formato.error) }, { status: 400 });
  const leitor = escopoDe(contexto!);
  const agora = new Date();
  const hoje = hojeEmSaoPaulo(agora);

  const entidadeTela = params.get("entidade_tela");
  let titulo = TITULO_EXPORTACAO_TERRITORIO;
  let nomeEntidade: string | undefined;
  let linhasDaEntidade: Awaited<ReturnType<typeof obterEntidade>> = null;
  if (entidadeTela !== null) {
    const entidade = ehUuid(entidadeTela) ? await obterEntidade(entidadeTela, leitor, hoje) : null;
    if (!entidade) return NextResponse.json({ erro: ENTIDADE_NAO_ENCONTRADA }, { status: 404 });
    nomeEntidade = entidade.entidade.nome;
    linhasDaEntidade = entidade;
    titulo = `NEXAIGEN — ${entidade.entidade.nome}${entidade.entidade.sigla ? ` (${entidade.entidade.sigla})` : ""} — prefeituras membro`;
  }
  const r = await consultarTerritorio(parametrosDaUrl(params, ["formato", "entidade_tela"]), leitor, hoje, { entidadeId: entidadeTela ?? undefined, linhas: linhasDaEntidade?.linhas });
  const filtros = [...(nomeEntidade ? [`membros de ${nomeEntidade}`] : []), descreverFiltros(r.filtros)].filter(Boolean).join(" · ");
  const nome = `${entidadeTela ? "entidade" : "territorio"}-${r.uf ?? "todas"}-${hoje}.${formato.data}`;
  const cabecalhos = { "cache-control": "no-store", "content-disposition": `attachment; filename="${nome}"` };
  if (formato.data === "csv") return new Response(gerarCsvTerritorio(r.todas, filtros, agora, titulo), { headers: { ...cabecalhos, "content-type": "text/csv; charset=utf-8" } });
  return new Response(new Uint8Array(gerarXlsxTerritorio(r.todas, filtros, agora, titulo)), { headers: { ...cabecalhos, "content-type": TIPO_MIME_XLSX } });
}
