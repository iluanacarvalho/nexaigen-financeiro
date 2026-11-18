// Gera lib/mapaBrasil.gerado.ts — contornos dos 27 estados em SVG, pra
// página pública /mapa (rodada 15-B). Roda UMA vez (o resultado é um
// arquivo estático versionado junto com o código); a página nunca baixa
// nada de terceiros.
//
//   npm run gerar-mapa-brasil
//
// Desde a rodada 15-C este script é só "baixar → gerar → gravar": toda a
// lógica (validação da malha, limites, projeção, simplificação, texto do
// arquivo) é a função PURA lib/geracaoMapaBrasil.ts#gerarArquivoMapaBrasil,
// testada sem rede em lib/geracaoMapaBrasil.test.ts.
//
// Fonte: malha do Brasil por UF da API do IBGE (dados públicos), qualidade "mínima".

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gerarArquivoMapaBrasil } from "../lib/geracaoMapaBrasil";

const URL_MALHA = "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=UF";

async function main() {
  const res = await fetch(URL_MALHA, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
  const conteudo = gerarArquivoMapaBrasil(await res.json(), URL_MALHA);
  const destino = join(__dirname, "..", "lib", "mapaBrasil.gerado.ts");
  writeFileSync(destino, conteudo);
  console.log(`✓ ${destino} — ${(conteudo.length / 1024).toFixed(0)} KB`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
