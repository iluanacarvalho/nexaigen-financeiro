// Peças de exportação de planilha compartilhadas (CSV do Painel desde a
// rodada 05; CSV/XLSX do relatório de novos contratos desde a 15-A) — uma
// regra só pra neutralizar injeção de fórmula, citar células e escrever
// centavos. Funções puras.

const INICIO_FORMULA = /^[=+\-@\t\r]/;

/**
 * Neutraliza injeção de fórmula (CSV injection): texto que começa com
 * = + - @ TAB ou CR ganha um apóstrofo na frente, e a planilha passa a
 * tratá-lo como texto literal. Aplicado SÓ a células de texto — número
 * formatado por nós mesmos não passa por aqui.
 */
export function neutralizarFormula(texto: string): string {
  return INICIO_FORMULA.test(texto) ? `'${texto}` : texto;
}

/** Aspas quando necessário (separador, aspas, quebra de linha), aspas internas duplicadas. */
export function celulaCsv(valor: string): string {
  return /[;"\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

/** Célula de TEXTO vinda de dado (nome, UF…): neutralizada e citada. */
export function celulaTextoCsv(texto: string): string {
  return celulaCsv(neutralizarFormula(texto));
}

/** Centavos → "4500,50" (vírgula decimal, sem separador de milhar — abre como número no Excel pt-BR). */
export function centavosCsv(centavos: number): string {
  const sinal = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sinal}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** BOM UTF-8 + linhas com CRLF (o Excel reconhece os acentos e o separador ";"). */
export function montarCsv(linhas: string[][]): string {
  return "\uFEFF" + linhas.map((l) => l.join(";")).join("\r\n") + "\r\n";
}
