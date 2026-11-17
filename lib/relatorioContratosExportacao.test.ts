// Exportação do relatório de novos contratos — CSV (BOM, ";", CRLF,
// cabeçalho com título/mês/data de geração, neutralização de fórmula,
// vírgula decimal) e XLSX (ZIP válido lido de volta, mesmas linhas, texto
// como inline string neutralizada, dinheiro numérico). E o gerador de ZIP/
// XLSX em si (lib/xlsx.ts): CRC32 conhecido, nomes de coluna, escape XML.

import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { montarRelatorioContratos, type LinhaClienteRelatorio } from "./relatorioContratos";
import { formatarGeradoEm, gerarCsvContratos, gerarXlsxContratos, nomeArquivoContratos, textoVariacao } from "./relatorioContratosExportacao";
import { crc32, escaparXml, gerarXlsx, nomeColuna } from "./xlsx";

/** Lê um ZIP (store ou deflate) pelo diretório central → { nome: conteúdo }. Confere o CRC de cada arquivo. */
function lerZip(zip: Buffer): Record<string, string> {
  const fim = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const arquivos: Record<string, string> = {};
  for (let i = 0; i < total; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const metodo = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const tamanho = zip.readUInt32LE(p + 20);
    const nomeLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const comentarioLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const nome = zip.subarray(p + 46, p + 46 + nomeLen).toString("utf8");
    const inicioDados = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const bruto = zip.subarray(inicioDados, inicioDados + tamanho);
    const conteudo = metodo === 0 ? bruto : inflateRawSync(bruto);
    expect(crc32(conteudo)).toBe(crc);
    arquivos[nome] = conteudo.toString("utf8");
    p += 46 + nomeLen + extraLen + comentarioLen;
  }
  return arquivos;
}

const AGORA = new Date("2026-11-17T17:05:00Z"); // 14:05 em Brasília
const cliente = (extra: Partial<LinhaClienteRelatorio>): LinhaClienteRelatorio => ({
  id: "x", nome: "P", uf: "PR", plano: "dispensa", valor_mensal: "1000.00", status_contrato: "ativo", taxa_implantacao: null,
  tem_implantacao_ativa: false, cancelamento_termino_em: null, data_inicio_contrato: "2026-11-05", municipio_id_externo: null, ...extra
});
const RELATORIO = montarRelatorioContratos({
  clientes: [
    cliente({ id: "a", nome: '=HYPERLINK("http://x";"clique")', valor_mensal: "4500.50", plano: "pequeno_porte", taxa_implantacao: "15000.00" }),
    cliente({ id: "b", nome: "Prefeitura de São João; do Sul", data_inicio_contrato: "2026-11-01", municipio_id_externo: "m" }),
    cliente({ id: "c", nome: "Antiga", data_inicio_contrato: "2026-10-03", valor_mensal: "2000.00" })
  ],
  eventos: [],
  mes: "2026-11",
  hoje: "2026-11-17"
});

describe("textos", () => {
  it("data de geração em Brasília e variação com sinal / sem base", () => {
    expect(formatarGeradoEm(AGORA)).toBe("17/11/2026 14:05");
    expect(formatarGeradoEm(new Date("2027-01-01T01:30:00Z"))).toBe("31/12/2026 22:30");
    expect(textoVariacao({ absoluta: 2, percentual: 50 })).toBe("+2 (+50%)");
    expect(textoVariacao({ absoluta: -1, percentual: -33.3 })).toBe("-1 (-33,3%)");
    expect(textoVariacao({ absoluta: 3, percentual: null })).toBe("+3 (—)");
    expect(nomeArquivoContratos("2026-11", "xlsx")).toBe("novos-contratos-2026-11.xlsx");
  });
});

describe("CSV", () => {
  const csv = gerarCsvContratos(RELATORIO, AGORA);
  const linhas = csv.slice(1).split("\r\n");

  it("BOM, CRLF, cabeçalho com título, mês e data de geração", () => {
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(linhas.slice(0, 3)).toEqual(["NEXAIGEN — Relatório de novos contratos", "Mês: 11/2026", "Gerado em: 17/11/2026 14:05 (horário de Brasília)"]);
  });

  it("resumo e tabela com a mesma regra da tela: ';', vírgula decimal, fórmula neutralizada, ';' citado", () => {
    expect(linhas).toContain("Novos contratos no mês;2");
    expect(linhas).toContain("MRR novo (R$);5500,50");
    expect(linhas).toContain("Implantação a cobrar dos novos (R$);15000,00");
    expect(linhas).toContain("Novos contratos em 10/2026;1");
    expect(linhas).toContain("Variação vs 10/2026 (contratos);1");
    expect(linhas).toContain("Variação vs 10/2026 (contratos, %);100,0");
    expect(linhas).toContain("Variação vs 10/2026 (MRR, R$);3500,50");
    expect(linhas).toContain("Variação vs 10/2026 (MRR, %);175,0");
    expect(csv).not.toMatch(/;'?\+/); // variação nunca vira texto começando com "+"
    expect(linhas).toContain("Prefeitura;UF;Plano;Valor mensal (R$);Taxa de implantação (R$);Início do contrato (assinatura);Status do contrato;Origem");
    expect(linhas).toContain('"Prefeitura de São João; do Sul";PR;Dispensa;1000,00;—;01/11/2026;Ativo;Integração Educa');
    expect(linhas).toContain(`"'=HYPERLINK(""http://x"";""clique"")";PR;Pequeno Porte;4500,50;15000,00;05/11/2026;Ativo;Cadastro manual`);
    expect(csv).not.toContain("Antiga"); // outubro não entra na tabela de novembro
  });

  it("mês vazio: diz que não há contrato novo (nunca um 0 fingindo dado)", () => {
    const vazio = gerarCsvContratos(montarRelatorioContratos({ clientes: [], eventos: [], mes: "2026-11", hoje: "2026-11-17" }), AGORA);
    expect(vazio).toContain("Novos contratos no mês;Nenhum contrato novo neste mês");
    expect(vazio).toContain("Variação vs 10/2026 (contratos, %);—"); // sem base: nunca divide por zero
  });
});

describe("XLSX", () => {
  it("ZIP válido com as partes do SpreadsheetML; texto inline neutralizado, dinheiro numérico com estilo moeda", () => {
    const arquivos = lerZip(gerarXlsxContratos(RELATORIO, AGORA));
    expect(Object.keys(arquivos)).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    const planilha = arquivos["xl/worksheets/sheet1.xml"];
    expect(planilha).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">NEXAIGEN — Relatório de novos contratos</t></is></c>');
    expect(planilha).toContain("Gerado em: 17/11/2026 14:05 (horário de Brasília)");
    expect(planilha).toContain(`<t xml:space="preserve">'=HYPERLINK(&quot;http://x&quot;;&quot;clique&quot;)</t>`);
    expect(planilha).toContain('<v>4500.50</v>');
    expect(planilha).toMatch(/<c r="B\d+" s="3"><v>100\.0<\/v><\/c>/); // variação % numérica, 1 casa
    expect(planilha).not.toContain("<f>"); // nenhuma fórmula
    expect(arquivos["xl/workbook.xml"]).toContain('name="Novos contratos 2026-11"');
  });

  it("gerador: CRC32 de referência, colunas, escape e número inválido recusado", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect([0, 25, 26, 27, 701, 702].map(nomeColuna)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(escaparXml('a<b>&"c"\u0001')).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
    expect(() => gerarXlsx([[{ tipo: "numero", valor: "1e5" }]], "x")).toThrow(/inválido/);
  });
});
