// CRM — exportar a carteira de leads (rodada 16-A). SÓ ADMIN: área
// "crm_gestao". GET ?formato=csv|xlsx + os mesmos filtros de GET /api/leads
// (sem paginação) → arquivo com título, filtros e data de geração
// (lib/crmExportacao.ts — fórmulas neutralizadas). Até LIMITE_EXPORTACAO leads.

import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { ExportarLeadsSchema } from "@/lib/crmSchemas";
import { listarLeads } from "@/lib/crmRepositorio";
import { gerarCsvCarteira, gerarXlsxCarteira } from "@/lib/crmExportacao";
import { escopoDe } from "@/lib/crmHttp";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { TIPO_MIME_XLSX } from "@/lib/xlsx";
import { detalhesDoErro } from "@/lib/validacao";

const LIMITE_EXPORTACAO = 10_000;

export async function GET(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  const negado = exigirPapel(contexto, "crm_gestao");
  if (negado) return negado;

  const parsed = ExportarLeadsSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ erro: "Filtros inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const { formato, ...f } = parsed.data;
  const agora = new Date();
  const hoje = hojeEmSaoPaulo(agora);
  const { leads } = await listarLeads(
    { etapa: f.etapa, vendedorId: f.vendedor_id, uf: f.uf, origem: f.origem, busca: f.busca, parados: f.parados, vencidas: f.vencidas, ordenar: f.ordenar, direcao: f.direcao, pagina: 1, porPagina: LIMITE_EXPORTACAO },
    escopoDe(contexto!),
    hoje
  );
  const filtros = Object.entries(f)
    .filter(([chave, valor]) => valor !== undefined && chave !== "ordenar" && chave !== "direcao")
    .map(([chave, valor]) => `${chave}=${valor}`)
    .join(", ");
  const nome = `carteira-de-leads-${hoje}.${formato}`;
  const cabecalhos = { "cache-control": "no-store", "content-disposition": `attachment; filename="${nome}"` };
  if (formato === "csv") return new Response(gerarCsvCarteira(leads, filtros, agora), { headers: { ...cabecalhos, "content-type": "text/csv; charset=utf-8" } });
  return new Response(new Uint8Array(gerarXlsxCarteira(leads, filtros, agora)), { headers: { ...cabecalhos, "content-type": TIPO_MIME_XLSX } });
}
