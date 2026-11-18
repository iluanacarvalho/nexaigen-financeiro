// Importa entidades intermunicipais E seus membros de um CSV (rodada 16-A2).
//
// USO: npm run importar-entidades-csv -- caminho/do/arquivo.csv
//
// Formato: docs/modelos/entidades-modelo.csv (uma linha por membro; os dados
// da entidade se repetem). TUDO é validado antes de gravar
// (lib/entidadesCsv.ts#validarCsvEntidades): código IBGE existe na base,
// fonte_url e verificado_em obrigatórios, tipo válido, e-mail válido. QUALQUER
// erro → nada é gravado e o relatório sai linha a linha. Sem erro → uma
// transação só (lib/entidadesServico.ts#importarEntidadesCsv). Reimportar
// atualiza (mesmo nome + UF), nunca duplica, nunca remove membro.

import { readFileSync, existsSync } from "node:fs";
import { lerCsv, relatorioErrosCsv, validarCsvEntidades, COLUNAS_CSV_ENTIDADES } from "../lib/entidadesCsv";
import { codigosNaBase, importarEntidadesCsv } from "../lib/entidadesServico";
import { hojeEmSaoPaulo } from "../lib/painelFinanceiro";

async function main() {
  const caminho = process.argv[2];
  if (!caminho || !existsSync(caminho)) {
    console.error("Uso: npm run importar-entidades-csv -- caminho/do/arquivo.csv");
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL não configurada.");
    process.exitCode = 1;
    return;
  }
  const conteudo = readFileSync(caminho, "utf-8");
  const linhas = lerCsv(conteudo);
  const iCodigo = (linhas[0] ?? []).map((c) => c.trim().toLowerCase()).indexOf(COLUNAS_CSV_ENTIDADES[11]);
  const codigos = iCodigo < 0 ? [] : [...new Set(linhas.slice(1).map((l) => (l[iCodigo] ?? "").trim()).filter(Boolean))];
  const resultado = validarCsvEntidades(conteudo, await codigosNaBase(codigos), hojeEmSaoPaulo(new Date()));
  if (!resultado.ok) {
    console.error(`✗ ${resultado.erros.length} linha(s) com erro — NADA foi gravado:\n${relatorioErrosCsv(resultado.erros)}`);
    process.exitCode = 1;
    return;
  }
  const r = await importarEntidadesCsv(resultado.entidades);
  console.log(
    `✓ ${resultado.linhasLidas} linhas · ${resultado.entidades.length} entidades (${r.entidadesCriadas} criadas, ${r.entidadesAtualizadas} atualizadas, ${r.entidadesSemMudanca} sem mudança) · membros: ${r.membrosNovos} novos, ${r.membrosJaExistentes} já existiam`
  );
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (globalThis as { __nexaigenFinPgPool?: { end: () => Promise<void> } }).__nexaigenFinPgPool?.end();
  });
