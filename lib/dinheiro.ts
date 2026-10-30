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
