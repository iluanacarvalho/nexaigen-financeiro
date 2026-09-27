import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Config separada de vitest.config.ts de propósito: só estes testes
// precisam do Postgres real (docker compose up -d && npm run migrate) —
// mesmo padrão do projeto irmão nexaigen-educa. PRIMEIRA suíte de
// integração deste projeto (antes só existiam testes unitários com o
// banco mockado) — parte da rodada de migração de infraestrutura
// (Supabase → pg direto), justamente porque a lógica do job de cron
// (insert condicional + trigger de data_limite) é exatamente o tipo de
// coisa que um mock pode disfarçar um erro de SQL real.
//
// resolve.alias "@" — vitest não lê tsconfig.json#paths sozinho (só o
// tsc lê). Os testes de integração importam os route handlers reais via
// "@/lib/**"/"@/app/**" — sem este alias, o vitest não resolve esses
// imports em runtime mesmo com o typecheck passando limpo.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false
  }
});
