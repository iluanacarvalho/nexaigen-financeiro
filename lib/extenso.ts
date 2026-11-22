// Valores e datas POR EXTENSO em português do Brasil (rodada 16-B1) — usados
// no contrato gerado (lib/contratoModelo.ts). Funções PURAS, sem dependência.
//
// Dinheiro sempre em CENTAVOS INTEIROS (lib/dinheiro.ts) — nunca float.
// Regras da escrita (norma usual de cheques/contratos):
//   - "e" entre centenas, dezenas e unidades ("cento e vinte e um");
//   - milhares: "mil", "dois mil"; entre grupos usa vírgula, e "e" quando o
//     grupo seguinte é < 100 ou é centena redonda ("mil e cem", "mil e
//     vinte", mas "cinco mil, quatrocentos e cinquenta e sete");
//   - "um milhão de reais" / "dois milhões de reais" (o "de" quando o valor
//     termina em milhão/milhões redondos);
//   - "um real", "um centavo"; só centavos → "cinquenta centavos";
//   - zero → "zero real".

const UNIDADES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** 0..999 por extenso ("cento e um", "cem", "vinte e um"). */
function ate999(n: number): string {
  if (n < 20) return UNIDADES[n];
  if (n < 100) return DEZENAS[Math.floor(n / 10)] + (n % 10 ? ` e ${UNIDADES[n % 10]}` : "");
  if (n === 100) return "cem";
  return CENTENAS[Math.floor(n / 100)] + (n % 100 ? ` e ${ate999(n % 100)}` : "");
}

const ESCALAS: [string, string][] = [
  ["", ""],
  ["mil", "mil"],
  ["milhão", "milhões"],
  ["bilhão", "bilhões"],
  ["trilhão", "trilhões"]
];

/** Inteiro ≥ 0 por extenso ("cinco mil, quatrocentos e cinquenta e sete"). */
export function inteiroPorExtenso(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Número inválido para extenso: ${n}`);
  if (n === 0) return "zero";
  const grupos: number[] = [];
  for (let resto = n; resto > 0; resto = Math.floor(resto / 1000)) grupos.push(resto % 1000);
  if (grupos.length > ESCALAS.length) throw new Error("Número grande demais para extenso.");
  const partes: { texto: string; valor: number }[] = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (g === 0) continue;
    const [singular, plural] = ESCALAS[i];
    let texto: string;
    if (i === 0) texto = ate999(g);
    else if (i === 1) texto = g === 1 ? "mil" : `${ate999(g)} mil`;
    else texto = `${ate999(g)} ${g === 1 ? singular : plural}`;
    partes.push({ texto, valor: g });
  }
  return partes
    .map((p, i) => {
      if (i === 0) return p.texto;
      // "e" antes do último grupo quando ele é < 100 ou centena redonda; senão vírgula.
      const ultimo = i === partes.length - 1;
      const usaE = ultimo && (p.valor < 100 || p.valor % 100 === 0);
      return `${usaE ? " e " : ", "}${p.texto}`;
    })
    .join("");
}

/** Centavos → "cinco mil, quatrocentos e cinquenta e sete reais e trinta centavos". */
export function valorPorExtenso(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos < 0) throw new Error(`Valor em centavos inválido: ${centavos}`);
  const reais = Math.floor(centavos / 100);
  const cents = centavos % 100;
  const textoCentavos = cents === 0 ? "" : `${inteiroPorExtenso(cents)} ${cents === 1 ? "centavo" : "centavos"}`;
  if (reais === 0) return cents === 0 ? "zero real" : textoCentavos;
  // "um milhão DE reais": valor inteiro terminado em milhão/bilhão redondos.
  const de = reais >= 1_000_000 && reais % 1_000_000 === 0 ? " de" : "";
  const textoReais = `${inteiroPorExtenso(reais)}${de} ${reais === 1 ? "real" : "reais"}`;
  return cents === 0 ? textoReais : `${textoReais} e ${textoCentavos}`;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-11-21" → "21 de novembro de 2026" (dia 1 → "1º de …"). */
export function dataPorExtenso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Data inválida para extenso: ${iso}`);
  const dia = Number(m[3]);
  return `${dia === 1 ? "1º" : dia} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

/** Centavos → "R$ 5.457,00" (formato fixo pt-BR, sem depender de Intl). */
export function formatarReais(centavos: number): string {
  const reais = Math.floor(centavos / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${reais},${String(centavos % 100).padStart(2, "0")}`;
}
