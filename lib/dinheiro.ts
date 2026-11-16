// Dinheiro em CENTAVOS INTEIROS — nunca ponto flutuante. Extraído de
// lib/painelFinanceiro.ts na rodada 08 (Painel, Dashboard e tela de Notas
// usam a mesma conversão). `numeric` chega do driver "pg" como string
// ("4500.50" — ver lib/db.ts) e é lido dígito a dígito por paraCentavos
// (nunca `Number("4500.50") * 100`, que pode dar 450049.99999…); somas em
// inteiros são exatas até 2^53 centavos; a divisão por 100 só acontece ao
// EXIBIR.


const NUMERIC = /^(-)?(\d+)(?:\.(\d*))?$/;

/**
 * "4500.50" → 450050. Lê a string sem passar por float. Mais de 2 casas
 * (não acontece com numeric(12,2), mas a função não assume isso)
 * arredonda meio-pra-cima pela 3ª casa. Valor que não é numérico lança —
 * dado corrompido nunca vira 0 em silêncio num painel de dinheiro.
 */
export function paraCentavos(valor: string | number): number {
  const texto = typeof valor === "number" ? valor.toFixed(2) : valor.trim();
  const m = NUMERIC.exec(texto);
  if (!m) throw new Error(`Valor monetário inválido: "${texto}"`);
  const [, sinal, inteiros, decimais = ""] = m;
  const casas = (decimais + "00").slice(0, 2);
  const arredonda = decimais.length > 2 && Number(decimais[2]) >= 5 ? 1 : 0;
  const centavos = Number(inteiros) * 100 + Number(casas) + arredonda;
  return sinal ? -centavos : centavos;
}

/** 450050 → "R$ 4.500,50" (exibição). null → "—". */
export function formatarMoeda(centavos: number | null): string {
  if (centavos === null) return "—";
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Centavos inteiros → texto pro parâmetro numeric do Postgres (450050 → "4500.50"). */
export function centavosParaNumeric(centavos: number): string {
  const sinal = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sinal}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const VALOR_TEXTO = /^\d{1,10}(?:[.,]\d{1,2})?$/;

/**
 * Valor monetário recebido como TEXTO ("1500", "1500.5", "1500,50") —
 * nunca como number do JSON, pra não passar por ponto flutuante. Até 10
 * dígitos inteiros (cabe em numeric(12,2)), no máximo 2 casas, sem
 * separador de milhar, positivo. Devolve centavos inteiros
 * (lib/painelFinanceiro.ts#paraCentavos — a mesma conversão do Painel).
 */
export function lerValorMonetario(valor: string): { ok: true; centavos: number } | { ok: false; erro: string } {
  const texto = valor.trim();
  if (!VALOR_TEXTO.test(texto)) {
    return { ok: false, erro: "Valor inválido — use só números, com vírgula ou ponto antes dos centavos (no máximo 2 casas), sem separador de milhar." };
  }
  const centavos = paraCentavos(texto.replace(",", "."));
  if (centavos <= 0) return { ok: false, erro: "O valor precisa ser maior que zero." };
  return { ok: true, centavos };
}

/** Centavos → texto pra um campo editável, no formato que a pessoa digita: 850000 → "8500,00" (sem separador de milhar). */
export function centavosParaTextoCampo(centavos: number): string {
  return `${Math.floor(centavos / 100)},${String(centavos % 100).padStart(2, "0")}`;
}
