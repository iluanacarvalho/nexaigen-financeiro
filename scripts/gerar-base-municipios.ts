// Gera scripts/dados/municipios-<UF>.json a partir da API PÚBLICA do IBGE
// (rodada 16-A2). Roda À MÃO, com rede, quando um estado novo vai ser
// liberado (ou pra atualizar a estimativa de população); o JSON gerado é
// COMMITADO e revisado no diff. A importação (scripts/importar-municipios.ts)
// lê só o arquivo — nunca a rede (produção não depende do IBGE).
//
// USO: npm run gerar-base-municipios -- PR
//
// Este script só baixa → monta → grava. A montagem (e todas as conferências)
// é pura, em lib/baseMunicipios.ts#montarBaseMunicipios (testada com fixture).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { codigoDaUf, montarBaseMunicipios, urlLocalidades, urlPopulacao } from "../lib/baseMunicipios";

async function baixar(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`IBGE respondeu ${res.status} em ${url}`);
  return res.json();
}

async function main() {
  const uf = (process.argv[2] ?? "").toUpperCase();
  if (!codigoDaUf(uf)) {
    console.error("Uso: npm run gerar-base-municipios -- <UF>   (ex.: PR)");
    process.exit(1);
  }
  const [localidades, populacao] = await Promise.all([baixar(urlLocalidades(uf)), baixar(urlPopulacao(uf))]);
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const arquivo = montarBaseMunicipios(uf, localidades, populacao, hoje);
  const destino = join(__dirname, "dados", `municipios-${uf}.json`);
  writeFileSync(destino, JSON.stringify(arquivo, null, 2) + "\n");

  const anos = [...new Set(arquivo.municipios.map((m) => m.populacao_ano).filter((a) => a !== null))];
  console.log(`✓ ${destino}`);
  console.log(`  municípios: ${arquivo.total}`);
  console.log(`  códigos com 7 dígitos: ${arquivo.municipios.filter((m) => /^[0-9]{7}$/.test(m.codigo_ibge)).length}`);
  console.log(`  ano da estimativa de população: ${anos.join(", ") || "—"}`);
  console.log(`  sem população na API (ficaram null): ${arquivo.sem_populacao.length ? arquivo.sem_populacao.join(", ") : "nenhum"}`);
  console.log(`  sem microrregião: ${arquivo.municipios.filter((m) => m.microrregiao === null).map((m) => `${m.codigo_ibge} ${m.nome}`).join(", ") || "nenhum"}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
