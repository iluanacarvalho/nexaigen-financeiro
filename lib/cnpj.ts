// CNPJ (rodada 16-B1) — funções PURAS. No banco o CNPJ é guardado só com os
// 14 dígitos (CHECK ck_cliente_prefeitura_cnpj, migration 0017); a tela e o
// contrato mostram formatado (12.345.678/0001-95).

/** Só os dígitos ("12.345.678/0001-95" → "12345678000195"). */
export function somenteDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

/** Dígito verificador do CNPJ pelos pesos oficiais (módulo 11). */
function digitoVerificador(base: string): number {
  const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = [...base].reduce((s, d, i) => s + Number(d) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * CNPJ válido: 14 dígitos (pontuação ignorada), dígitos verificadores
 * corretos, e não todos iguais (00000000000000 passa no cálculo mas não existe).
 */
export function cnpjValido(texto: string): boolean {
  const d = somenteDigitos(texto);
  if (!/^[0-9]{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const primeiro = digitoVerificador(d.slice(0, 12));
  const segundo = digitoVerificador(d.slice(0, 12) + primeiro);
  return d.endsWith(`${primeiro}${segundo}`);
}

/** "12345678000195" → "12.345.678/0001-95" (o que não tiver 14 dígitos volta como veio). */
export function formatarCnpj(texto: string): string {
  const d = somenteDigitos(texto);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : texto;
}

/** "86010000" → "86010-000". */
export function formatarCep(texto: string): string {
  const d = somenteDigitos(texto);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : texto;
}
