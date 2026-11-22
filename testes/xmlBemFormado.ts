// Helper SÓ de teste (rodada 16-B1): o XML está BEM FORMADO? Sem dependência:
// confere declaração, tags abrindo/fechando na ordem certa, atributos entre
// aspas e entidades válidas. Quando o `xmllint` (libxml2) existe na máquina,
// os testes do .docx o usam TAMBÉM (verificação independente).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Problemas encontrados (vazio = bem formado). */
export function problemasDoXml(xml: string): string[] {
  const problemas: string[] = [];
  const corpo = xml.replace(/^<\?xml[^?]*\?>\s*/, "");
  if (corpo === xml && xml.startsWith("<?xml")) problemas.push("declaração <?xml ?> malformada");
  const pilha: string[] = [];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/g;
  let fim = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(corpo))) {
    const texto = corpo.slice(fim, m.index);
    if (texto.includes("<") || texto.includes(">")) problemas.push(`marcação inválida perto de: ${texto.slice(0, 40)}`);
    for (const ent of texto.match(/&[^;\s]*;?/g) ?? []) if (!/^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);$/i.test(ent)) problemas.push(`entidade inválida: ${ent}`);
    const [, fecha, nome, , auto] = m;
    if (fecha) {
      const aberta = pilha.pop();
      if (aberta !== nome) problemas.push(`</${nome}> fecha <${aberta ?? "nada"}>`);
    } else if (!auto) pilha.push(nome);
    fim = tag.lastIndex;
  }
  if (corpo.slice(fim).trim() !== "") problemas.push("texto depois do elemento raiz");
  if (pilha.length) problemas.push(`tags não fechadas: ${pilha.join(", ")}`);
  return problemas;
}

/** xmllint disponível? Então valida também por ele (null = ferramenta ausente). */
export function xmllint(xml: string): { ok: boolean; saida: string } | null {
  if (spawnSync("xmllint", ["--version"]).error) return null;
  const pasta = mkdtempSync(join(tmpdir(), "xml-"));
  try {
    const arquivo = join(pasta, "a.xml");
    writeFileSync(arquivo, xml);
    const r = spawnSync("xmllint", ["--noout", arquivo], { encoding: "utf-8" });
    return { ok: r.status === 0, saida: r.stderr };
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}
