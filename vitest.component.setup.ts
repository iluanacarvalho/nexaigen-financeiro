// Setup dos testes de componente (vitest.component.config.ts).
// @testing-library/react só limpa o DOM entre testes sozinho com
// `globals: true` — este projeto importa tudo explicitamente de "vitest",
// então a limpeza é registrada aqui (sem isto, o DOM de um it() vazaria
// pro próximo no mesmo arquivo). Mocks de fetch/global são desfeitos
// entre testes pra nenhum teste herdar a resposta falsa de outro.

import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
