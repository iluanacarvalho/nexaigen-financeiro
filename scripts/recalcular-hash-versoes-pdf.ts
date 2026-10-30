// npm run recalcular-hash-versoes — preenche sha256/tamanho_bytes das
// versões de PDF (nota fiscal e contrato) que vieram de backfill sem eles.
// Toda a lógica (e o teste) está em lib/recalcularHashVersoes.ts; este
// script só roda e imprime o relatório. Idempotente — pode rodar quantas
// vezes quiser.
//
// Saída 0 quando não houve ERRO (objeto ausente no bucket é reportado mas
// não falha o script — é dado legado inconsistente, rodar de novo não
// resolve); saída 1 se alguma versão deu erro (bucket indisponível, etc.)
// — vale rodar de novo depois.
//
// Uso: npm run recalcular-hash-versoes   (lê DATABASE_URL e RAILWAY_BUCKET_* de .env/.env.local)

import { recalcularHashesVersoes } from "../lib/recalcularHashVersoes";

async function main() {
  const r = await recalcularHashesVersoes();
  console.log(`Versões sem hash/tamanho encontradas: ${r.total}`);
  console.log(`  ✓ recalculadas:              ${r.ok}`);
  console.log(`  ∅ objeto ausente no bucket: ${r.objetoAusente}`);
  console.log(`  ✗ erro (tente de novo):      ${r.erro}`);
  for (const f of r.falhas) console.log(`    - ${f.tabela} ${f.id} (${f.motivo}) chave=${f.chave}`);
  process.exit(r.erro > 0 ? 1 : 0);
}

main().catch((erro) => {
  console.error("Falha inesperada:", erro instanceof Error ? erro.message : "erro desconhecido");
  process.exit(1);
});
