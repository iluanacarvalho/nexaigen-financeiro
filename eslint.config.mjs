// ESLint (flat config) — não existia nenhum até a rodada 05b: o script
// "lint" chamava `next lint`, removido no Next 16, e o projeto não tinha
// ESLint instalado. Mesmo estilo do projeto irmão nexaigen-educa:
// eslint-config-next — core-web-vitals (regras de React/Next/acessibilidade)
// + typescript (typescript-eslint recommended).
//
// Travas estruturais (viram erro de lint, não só disciplina de review):
//   - "pg" só pode ser importado em lib/db.ts — o único ponto de acesso ao
//     Postgres (pool, type parsers). Diferente do Educa, aqui as rotas
//     PODEM importar @/lib/db direto (projeto mono-tenant, sem camada de
//     repositórios obrigatória — ver o comentário de topo de lib/db.ts);
//     o que fica proibido é contornar lib/db.ts e falar com o driver.
//   - O SDK da AWS só pode ser importado em lib/armazenamentoObjetos.ts
//     (mesma regra do Educa) — o resto do código só conhece
//     uploadArquivo()/gerarUrlDownload().
// Ficam fora das travas, de propósito: scripts/** (scripts/migrate.ts roda
// migrações brutas com "pg", fora do runtime da aplicação) e os testes
// (*.test.ts mocka o SDK da AWS; os de integração montam fixtures numa
// transação com o tipo PoolClient do "pg").
//
// As duas travas ficam num ÚNICO objeto `no-restricted-imports` de
// propósito: no flat config, dois objetos com a mesma regra casando o
// mesmo arquivo não se somam — o de trás substitui o da frente (mesma
// observação do eslint.config.mjs do Educa). Consequência aceita:
// lib/db.ts e lib/armazenamentoObjetos.ts ficam isentos das duas travas,
// não só da "sua".

import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const mensagemSdkAws =
  "O SDK da AWS só pode ser importado dentro de lib/armazenamentoObjetos.ts — use uploadArquivo()/gerarUrlDownload().";

const travasDeImport = {
  files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "instrumentation.ts"],
  ignores: ["lib/db.ts", "lib/armazenamentoObjetos.ts", "**/*.test.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          { name: "pg", message: "Use lib/db.ts (query/withTransaction) — é o único arquivo que fala direto com o driver \"pg\"." },
          { name: "@aws-sdk/client-s3", message: mensagemSdkAws },
          { name: "@aws-sdk/s3-request-presigner", message: mensagemSdkAws },
          { name: "@smithy/node-http-handler", message: mensagemSdkAws }
        ]
      }
    ]
  }
};

const config = [...coreWebVitals, ...typescript, travasDeImport];

export default config;
