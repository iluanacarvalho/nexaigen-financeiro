// Gerador de .docx (Word editável) MÍNIMO (rodada 16-B1), sem dependência
// nova: um .docx é um ZIP com alguns XMLs (Office Open XML /
// WordprocessingML) — reaproveita o ZIP "store" e o escape de XML do
// gerador de planilha (lib/xlsx.ts). Só o necessário pro contrato:
// títulos (estilos Titulo1/Titulo2), parágrafos com quebras de linha,
// negrito, CABEÇALHO (em todas as páginas — a faixa de RASCUNHO) e RODAPÉ
// simples. Texto sempre escapado; caracteres de controle removidos.
// Funções puras; testado em lib/docx.test.ts (lê o ZIP de volta e confere o XML).

import type { Bloco, TrechoTexto } from "./contratoModelo";
import { escaparXml, montarZip } from "./xlsx";

export const TIPO_MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function run(t: TrechoTexto, extra = ""): string {
  const rpr = t.negrito || extra ? `<w:rPr>${t.negrito ? "<w:b/>" : ""}${extra}</w:rPr>` : "";
  return `<w:r>${rpr}<w:t xml:space="preserve">${escaparXml(t.texto)}</w:t></w:r>`;
}

function paragrafo(b: Bloco): string {
  const estilo = b.tipo === "titulo" ? `<w:pPr><w:pStyle w:val="Titulo1"/></w:pPr>` : b.tipo === "subtitulo" ? `<w:pPr><w:pStyle w:val="Titulo2"/></w:pPr>` : `<w:pPr><w:spacing w:after="160"/><w:jc w:val="both"/></w:pPr>`;
  const linhas = b.linhas.map((l) => l.map((t) => run(t)).join("")).join("<w:r><w:br/></w:r>");
  return `<w:p>${estilo}${linhas}</w:p>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Titulo1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="240"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Titulo2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`;

function parteSimples(tag: "hdr" | "ftr", texto: string, rpr: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:${tag} xmlns:w="${NS_W}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run({ texto, negrito: false }, rpr)}</w:p></w:${tag}>`;
}

export interface DocumentoDocx {
  blocos: Bloco[];
  /** Texto do cabeçalho em TODAS as páginas (ex.: faixa de RASCUNHO); null = sem cabeçalho. */
  cabecalho: string | null;
  /** Texto do rodapé em todas as páginas. */
  rodape: string;
}

/** Monta o .docx. */
export function gerarDocx(doc: DocumentoDocx): Buffer {
  const texto = (s: string) => Buffer.from(s, "utf8");
  const comCabecalho = doc.cabecalho !== null;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${comCabecalho ? `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>` : ""}<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdEstilos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${comCabecalho ? `<Relationship Id="rIdCabecalho" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>` : ""}<Relationship Id="rIdRodape" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;
  const secao = `<w:sectPr>${comCabecalho ? `<w:headerReference w:type="default" r:id="rIdCabecalho"/>` : ""}<w:footerReference w:type="default" r:id="rIdRodape"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>`;
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${doc.blocos.map(paragrafo).join("")}${secao}</w:body></w:document>`;
  return montarZip([
    { nome: "[Content_Types].xml", conteudo: texto(contentTypes) },
    { nome: "_rels/.rels", conteudo: texto(rels) },
    { nome: "word/document.xml", conteudo: texto(documento) },
    { nome: "word/_rels/document.xml.rels", conteudo: texto(documentRels) },
    { nome: "word/styles.xml", conteudo: texto(STYLES) },
    ...(comCabecalho ? [{ nome: "word/header1.xml", conteudo: texto(parteSimples("hdr", doc.cabecalho!, `<w:b/><w:color w:val="C00000"/><w:sz w:val="20"/>`)) }] : []),
    { nome: "word/footer1.xml", conteudo: texto(parteSimples("ftr", doc.rodape, `<w:color w:val="595959"/><w:sz w:val="16"/>`)) }
  ]);
}
