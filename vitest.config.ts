import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// resolve.alias "@" — vitest não lê tsconfig.json#paths sozinho (só o tsc
// lê). app/api/cron/verificar-prazos/route.test.ts importa o route handler
// real, que importa "@/lib/**" internamente — sem este alias, o vitest não
// resolve esses imports em runtime mesmo com o typecheck passando limpo
// (mesmo achado documentado em nexaigen-educa/vitest.integration.config.ts).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"]
  }
});
