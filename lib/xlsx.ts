// Gerador de planilha .xlsx MÍNIMO (rodada 15-A — relatório de novos
// contratos), sem dependência nova: um .xlsx é um ZIP com alguns XMLs
// (Office Open XML / SpreadsheetML). Escrevemos só o necessário pra uma
// aba com texto e números:
//   - ZIP no método "store" (sem compressão) — o formato aceita, e assim o
//     arquivo inteiro é montado com Buffer + CRC32 (tabela própria abaixo);
//   - texto sempre como INLINE STRING (t="inlineStr"): nunca é avaliado
//     como fórmula pela planilha. Mesmo assim, quem chama passa o texto
//     por lib/exportacao.ts#neutralizarFormula (mesma regra do CSV);
//   - número como texto decimal já pronto ("4500.50", de
//     lib/dinheiro.ts#centavosParaNumeric) — nenhuma conta em ponto
//     flutuante aqui; estilo "moeda" (#,##0.00) ou inteiro.
// Funções puras; testado em lib/xlsx.test.ts (lê o ZIP de volta).

export type CelulaXlsx =
  | { tipo: "texto"; valor: string }
  | { tipo: "numero"; valor: string; estilo?: "moeda" | "inteiro" | "decimal" }
  | null;

// --- XML ---------------------------------------------------------------------

/** Escapa pro XML e remove caracteres de controle que o XML 1.0 não aceita (exceto TAB/LF/CR). */
export function escaparXml(texto: string): string {
  return texto
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Índice de coluna (0 = A) → letras ("A", "Z", "AA"…). */
export function nomeColuna(indice: number): string {
  let n = indice + 1;
  let nome = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    nome = String.fromCharCode(65 + resto) + nome;
    n = Math.floor((n - 1) / 26);
  }
  return nome;
}

const NUMERO = /^-?\d+(\.\d+)?$/;
const ESTILO: Record<"moeda" | "inteiro" | "decimal", number> = { moeda: 1, inteiro: 2, decimal: 3 };

function celulaXml(celula: CelulaXlsx, ref: string): string {
  if (celula === null) return "";
  if (celula.tipo === "texto") return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(celula.valor)}</t></is></c>`;
  if (!NUMERO.test(celula.valor)) throw new Error(`Número inválido pra planilha: "${celula.valor}"`);
  return `<c r="${ref}" s="${ESTILO[celula.estilo ?? "moeda"]}"><v>${celula.valor}</v></c>`;
}

function planilhaXml(linhas: CelulaXlsx[][]): string {
  const corpo = linhas
    .map((linha, i) => `<row r="${i + 1}">${linha.map((c, j) => celulaXml(c, `${nomeColuna(j)}${i + 1}`)).join("")}</row>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${corpo}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

// Estilos: 0 = padrão, 1 = moeda (#,##0.00), 2 = inteiro (formato embutido 1 = "0"), 3 = 1 casa decimal (0.0).
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function workbookXml(nomeAba: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escaparXml(nomeAba)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

// --- ZIP (método store) --------------------------------------------------------

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

export function crc32(dados: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of dados) crc = TABELA_CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Data/hora DOS fixa (1980-01-01 00:00): o conteúdo não depende do relógio — mesmo dado, mesmo arquivo.
const DATA_DOS = 0x0021;
const HORA_DOS = 0;

/** ZIP sem compressão com os arquivos na ordem dada. */
export function montarZip(arquivos: { nome: string; conteudo: Buffer }[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;
  for (const { nome, conteudo } of arquivos) {
    const nomeBytes = Buffer.from(nome, "utf8");
    const crc = crc32(conteudo);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // flag: nome em UTF-8
    local.writeUInt16LE(0, 8); // método: store
    local.writeUInt16LE(HORA_DOS, 10);
    local.writeUInt16LE(DATA_DOS, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(conteudo.length, 18);
    local.writeUInt32LE(conteudo.length, 22);
    local.writeUInt16LE(nomeBytes.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nomeBytes, conteudo);

    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4); // versão que gerou
    entrada.writeUInt16LE(20, 6); // versão necessária
    entrada.writeUInt16LE(0x0800, 8);
    entrada.writeUInt16LE(0, 10);
    entrada.writeUInt16LE(HORA_DOS, 12);
    entrada.writeUInt16LE(DATA_DOS, 14);
    entrada.writeUInt32LE(crc, 16);
    entrada.writeUInt32LE(conteudo.length, 20);
    entrada.writeUInt32LE(conteudo.length, 24);
    entrada.writeUInt16LE(nomeBytes.length, 28);
    entrada.writeUInt32LE(deslocamento, 42);
    central.push(entrada, nomeBytes);

    deslocamento += local.length + nomeBytes.length + conteudo.length;
  }
  const diretorio = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, diretorio, fim]);
}

/** Planilha .xlsx de UMA aba. */
export function gerarXlsx(linhas: CelulaXlsx[][], nomeAba: string): Buffer {
  const texto = (s: string) => Buffer.from(s, "utf8");
  return montarZip([
    { nome: "[Content_Types].xml", conteudo: texto(CONTENT_TYPES) },
    { nome: "_rels/.rels", conteudo: texto(RELS) },
    { nome: "xl/workbook.xml", conteudo: texto(workbookXml(nomeAba)) },
    { nome: "xl/_rels/workbook.xml.rels", conteudo: texto(WORKBOOK_RELS) },
    { nome: "xl/styles.xml", conteudo: texto(STYLES) },
    { nome: "xl/worksheets/sheet1.xml", conteudo: texto(planilhaXml(linhas)) }
  ]);
}

export const TIPO_MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
