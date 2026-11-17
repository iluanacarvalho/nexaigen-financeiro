// Relatório de novos contratos (rodada 15-A). Sessão + papel: área
// "contratos" (admin e financeiro — lib/papeis.ts). Os números são os da
// tela /contratos (mesma função, lib/relatorioContratosRepositorio.ts).
//
// GET ?mes=aaaa-mm (padrão: mês atual em America/Sao_Paulo)
//     &formato=json (padrão) | csv | xlsx
// 400 mês inválido/futuro ou parâmetro desconhecido (objeto estrito).
// Vigência a partir da assinatura: novo = data_inicio_contrato no mês.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NOME_COOKIE_ACCESS, exigirPapel, obterContextoAutenticado } from "@/lib/auth";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { validarMes } from "@/lib/relatorioContratos";
import { obterRelatorioContratos } from "@/lib/relatorioContratosRepositorio";
import { gerarCsvContratos, gerarXlsxContratos, nomeArquivoContratos } from "@/lib/relatorioContratosExportacao";
import { TIPO_MIME_XLSX } from "@/lib/xlsx";
import { detalhesDoErro } from "@/lib/validacao";

const ParametrosSchema = z.strictObject({
  mes: z.string().optional(),
  formato: z.enum(["json", "csv", "xlsx"], { error: "formato inválido — use json, csv ou xlsx." }).default("json")
});

export async function GET(req: NextRequest) {
  const negado = exigirPapel(await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value), "contratos");
  if (negado) return negado;

  const parsed = ParametrosSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ erro: "Filtros inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const agora = new Date();
  const mesAtual = hojeEmSaoPaulo(agora).slice(0, 7);
  const mes = parsed.data.mes ?? mesAtual;
  const erroMes = validarMes(mes, mesAtual);
  if (erroMes) return NextResponse.json({ erro: "Filtros inválidos", detalhes: { formErrors: [], fieldErrors: { mes: [erroMes] } } }, { status: 400 });

  const relatorio = await obterRelatorioContratos(mes, agora);
  const semCache = { "cache-control": "no-store" };
  if (parsed.data.formato === "json") return NextResponse.json(relatorio, { headers: semCache });
  if (parsed.data.formato === "csv") {
    return new Response(gerarCsvContratos(relatorio, agora), {
      headers: { ...semCache, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${nomeArquivoContratos(mes, "csv")}"` }
    });
  }
  return new Response(new Uint8Array(gerarXlsxContratos(relatorio, agora)), {
    headers: { ...semCache, "content-type": TIPO_MIME_XLSX, "content-disposition": `attachment; filename="${nomeArquivoContratos(mes, "xlsx")}"` }
  });
}
