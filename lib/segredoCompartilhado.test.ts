// Testes unitários de lib/segredoCompartilhado.ts — puros.

import { describe, expect, it } from "vitest";
import { bearerConfere } from "./segredoCompartilhado";

describe("bearerConfere", () => {
  it("aceita só o header exato", () => {
    expect(bearerConfere("Bearer s3gr3do-longo", "s3gr3do-longo")).toBe(true);
    expect(bearerConfere("Bearer s3gr3do-long", "s3gr3do-longo")).toBe(false);
    expect(bearerConfere("bearer s3gr3do-longo", "s3gr3do-longo")).toBe(false);
    expect(bearerConfere("s3gr3do-longo", "s3gr3do-longo")).toBe(false);
  });

  it("comprimentos muito diferentes não lançam (timingSafeEqual nunca recebe tamanhos diferentes)", () => {
    expect(() => bearerConfere("Bearer x", "um-segredo-bem-mais-longo-que-o-enviado")).not.toThrow();
    expect(bearerConfere("Bearer x", "um-segredo-bem-mais-longo-que-o-enviado")).toBe(false);
    expect(bearerConfere(`Bearer ${"a".repeat(10_000)}`, "curto")).toBe(false);
  });

  it("header ausente ou segredo vazio nunca autenticam", () => {
    expect(bearerConfere(null, "segredo")).toBe(false);
    expect(bearerConfere("", "segredo")).toBe(false);
    expect(bearerConfere("Bearer ", "")).toBe(false);
  });
});
