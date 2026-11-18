// lib/papeis.ts — matriz papel × área completa, negação por padrão e itens da NavBar.

import { describe, expect, it } from "vitest";
import { AREAS, PAPEIS, ehPapel, itensNavDoPapel, podeAcessar, rotuloDoPapel } from "./papeis";

/** A matriz inteira, escrita à mão — mudar a regra exige mudar este teste. */
const ESPERADO: Record<string, string[]> = {
  admin: [...AREAS],
  financeiro: ["inicio", "dashboard", "painel", "contratos", "notas", "checagem", "clientes", "alertas"],
  vendas: ["inicio", "crm"],
  rh: ["inicio"]
};

describe("matriz de acesso", () => {
  it.each(PAPEIS.flatMap((p) => AREAS.map((a) => [p, a] as const)))("%s × %s", (papel, area) => {
    expect(podeAcessar(papel, area)).toBe(ESPERADO[papel].includes(area));
  });

  it("negação por padrão: área nova/desconhecida só admin; papel desconhecido nada", () => {
    expect(podeAcessar("admin", "modulo_futuro")).toBe(true);
    for (const papel of ["financeiro", "vendas", "rh"]) expect(podeAcessar(papel, "modulo_futuro")).toBe(false);
    // Gestão do CRM (exportar carteira, reatribuir vendedor) é área própria: só admin, nem vendas.
    for (const papel of ["financeiro", "vendas", "rh"]) expect(podeAcessar(papel, "crm_gestao")).toBe(false);
    expect(podeAcessar("diretor", "inicio")).toBe(false);
    expect(podeAcessar("", "inicio")).toBe(false);
    expect(ehPapel("financeiro")).toBe(true);
    expect(ehPapel("Admin")).toBe(false);
  });

  it("rótulos em português", () => {
    expect(PAPEIS.map(rotuloDoPapel)).toEqual(["Administrador", "Financeiro", "Vendas", "RH"]);
    expect(rotuloDoPapel("xyz")).toBe("xyz");
  });
});

describe("itens da NavBar por papel", () => {
  const hrefs = (papel: string) => itensNavDoPapel(papel).map((i) => i.href);
  it("admin vê tudo (inclusive CRM); financeiro sem Equipe e sem CRM; vendas: Início + CRM; rh: só Início", () => {
    expect(hrefs("admin")).toEqual(["/", "/painel", "/contratos", "/notas", "/checagem", "/clientes", "/alertas", "/crm", "/equipe"]);
    expect(hrefs("financeiro")).toEqual(["/", "/painel", "/contratos", "/notas", "/checagem", "/clientes", "/alertas"]);
    expect(itensNavDoPapel("vendas")).toEqual([
      { href: "/", rotulo: "Início", area: "inicio" },
      { href: "/crm", rotulo: "CRM", area: "crm" }
    ]);
    expect(itensNavDoPapel("rh")).toEqual([{ href: "/", rotulo: "Início", area: "inicio" }]);
  });
});
