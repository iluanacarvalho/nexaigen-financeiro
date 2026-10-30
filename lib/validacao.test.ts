// lib/validacao.ts — o formato de `detalhes` é contrato da API (igual ao
// `.flatten()` do zod 3) e o uuid aceita todo id que o sistema gera.

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { detalhesDoErro, ehUuid } from "./validacao";

describe("detalhesDoErro — mesmo formato do .flatten() do zod 3", () => {
  it("campo inválido → fieldErrors[campo] = [mensagem]; formErrors vazio", () => {
    const r = z.object({ valor: z.number().positive("O valor precisa ser maior que zero.") }).safeParse({ valor: -1 });
    if (r.success) throw new Error("inesperado");
    expect(detalhesDoErro(r.error)).toEqual({ formErrors: [], fieldErrors: { valor: ["O valor precisa ser maior que zero."] } });
  });

  it("chave desconhecida em objeto estrito e refine sem path → formErrors (não fieldErrors)", () => {
    const estrito = z.strictObject({ a: z.string() }).safeParse({ a: "x", intrusa: 1 });
    if (estrito.success) throw new Error("inesperado");
    const d = detalhesDoErro(estrito.error);
    expect(d.fieldErrors).toEqual({});
    expect(d.formErrors).toHaveLength(1);
    expect(d.formErrors[0]).toContain("intrusa");

    const refinado = z.object({ a: z.string().optional() }).refine((v) => v.a !== undefined, { error: "Envie ao menos um campo." }).safeParse({});
    if (refinado.success) throw new Error("inesperado");
    expect(detalhesDoErro(refinado.error)).toEqual({ formErrors: ["Envie ao menos um campo."], fieldErrors: {} });
  });

  it("vários erros no mesmo campo acumulam na ordem", () => {
    const r = z.object({ s: z.string().min(5, "curto").regex(/^\d+$/, "só dígitos") }).safeParse({ s: "ab" });
    if (r.success) throw new Error("inesperado");
    expect(detalhesDoErro(r.error).fieldErrors.s).toEqual(["curto", "só dígitos"]);
  });

  it("é JSON serializável sem perder nada (é o que vai na resposta)", () => {
    const r = z.object({ x: z.number() }).safeParse({ x: "a" });
    if (r.success) throw new Error("inesperado");
    const d = detalhesDoErro(r.error);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(Object.keys(d).sort()).toEqual(["fieldErrors", "formErrors"]);
  });
});

describe("ehUuid — zod 4 (RFC 9562/4122) aceita todo id que o sistema gera", () => {
  it("crypto.randomUUID() (o que os testes e o Node geram) — 200 amostras", () => {
    for (let i = 0; i < 200; i++) expect(ehUuid(randomUUID())).toBe(true);
  });

  it.each([
    "7a1b2c3d-0000-4000-8000-000000000001",
    "7a1b2c3d-0000-4000-8000-0000000000aa",
    "6f1c2b0e-5a4d-4c3b-9e8f-1a2b3c4d5e6f",
    "0b6c5c0e-2f7d-4d8e-9a1b-3c4d5e6f7a8b",
    "7A1B2C3D-0000-4000-8000-000000000001"
  ])("fixture dos testes %s → válido", (id) => {
    expect(ehUuid(id)).toBe(true);
  });

  it.each([
    ["texto qualquer", "nota-1"],
    ["sem hífens", "7a1b2c3d000040008000000000000001"],
    ["variante fora da RFC (c)", "7a1b2c3d-0000-4000-c000-000000000001"],
    ["vazio", ""]
  ])("%s → inválido", (_d, id) => {
    expect(ehUuid(id)).toBe(false);
  });
});
