// Importa scripts/dados/municipios-<UF>.json em municipio_base (rodada 16-A2).
// SEM REDE: lê só o arquivo commitado. Confere o arquivo inteiro antes de
// gravar (lib/baseMunicipios.ts#validarBaseMunicipios) e faz upsert
// idempotente numa transação (lib/municipiosImportacao.ts) — nunca apaga.
// Rodar duas vezes seguidas: a segunda dá 0 inseridos e 0 atualizados.
//
// USO: npm run importar-municipios -- PR
//
// Importar NÃO libera o estado pro comercial: isso é ato do admin na tela
// /crm/estados.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { codigoDaUf, validarBaseMunicipios } from "../lib/baseMunicipios";
import { importarMunicipios } from "../lib/municipiosImportacao";

async function main() {
  const uf = (process.argv[2] ?? "").toUpperCase();
  if (!codigoDaUf(uf)) {
    console.error("Uso: npm run importar-municipios -- <UF>   (ex.: PR)");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL não configurada.");
    process.exit(1);
  }
  const caminho = join(__dirname, "dados", `municipios-${uf}.json`);
  if (!existsSync(caminho)) {
    console.error(`Arquivo ${caminho} não existe — gere com: npm run gerar-base-municipios -- ${uf}`);
    process.exit(1);
  }
  const validacao = validarBaseMunicipios(JSON.parse(readFileSync(caminho, "utf-8")), uf);
  if (!validacao.ok) {
    console.error(`✗ Arquivo inválido — nada foi gravado:\n  ${validacao.erros.join("\n  ")}`);
    process.exit(1);
  }
  const r = await importarMunicipios(uf, validacao.municipios);
  console.log(`✓ ${uf}: ${validacao.municipios.length} no arquivo · ${r.inseridos} inseridos · ${r.atualizados} atualizados · ${r.inalterados} sem mudança · ${r.totalDaUf} no banco`);
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (globalThis as { __nexaigenFinPgPool?: { end: () => Promise<void> } }).__nexaigenFinPgPool?.end();
  });
