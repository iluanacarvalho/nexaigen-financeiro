import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes de COMPONENTE (telas) — rodada 08. Config própria, mesma
// organização do nexaigen-educa: ambiente "jsdom" (as outras duas suítes
// são "node" e não pagam o custo de carregar jsdom), arquivos
// *.component.test.tsx, `npm run test:component`. Nenhum teste aqui toca
// banco, bucket ou Resend: o fetch é substituído por teste
// (vi.stubGlobal), e a guarda de APIs externas vale aqui também.
//
// Diferença consciente em relação ao Educa: sem @testing-library/jest-dom
// (matchers como toBeInTheDocument). A instalação dele com npm 10 — o npm
// do CI — dispara um erro interno do npm ("Cannot read properties of null
// (reading 'edgesOut')"); os testes usam asserções comuns do vitest sobre
// o DOM, sem perder nenhuma checagem.
//
// DATABASE_URL fictícia: telas Server Component (Painel, Dashboard)
// importam módulos que carregam lib/db.ts, que cria o Pool na importação
// (sem conectar). Os testes mockam essas leituras; nada conecta de verdade.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  },
  test: {
    environment: "jsdom",
    // Testes de tela (jsdom + digitação simulada) ficam lentos em máquina/CI carregados; 5 s (padrão) dava timeout sem haver travamento. Um teste que trava de verdade continua falhando, só mais tarde.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: ["**/*.component.test.tsx"],
    exclude: ["**/node_modules/**"],
    setupFiles: ["./vitest.component.setup.ts", "./vitest.setup.sem-apis-externas.ts"],
    env: {
      DATABASE_URL: "postgres://ficticio:ficticio@127.0.0.1:1/ficticio"
    }
  }
});
