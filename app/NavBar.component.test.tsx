// NavBar — itens por papel (rodada 15-A): cada papel vê só o que pode
// acessar (lib/papeis.ts); vendas: "Início" + CRM (16-A); rh só "Início". Esconder o link é UX —
// o bloqueio de verdade é o layout de cada página e o exigirPapel da API.

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import NavBar from "./NavBar";

function links(papel: "admin" | "financeiro" | "vendas" | "rh") {
  const { unmount } = render(<NavBar nome="Pessoa" papel={papel} />);
  const nav = screen.getByRole("navigation", { name: "Navegação principal" });
  const itens = within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
  const rotulo = within(nav).getByText(/\(.+\)/).textContent;
  unmount();
  return { itens, rotulo };
}

describe("NavBar por papel", () => {
  it("admin: todos os itens, inclusive Novos contratos e Equipe", () => {
    const { itens, rotulo } = links("admin");
    expect(itens).toEqual([
      ["Dashboard", "/"], ["Painel", "/painel"], ["Novos contratos", "/contratos"], ["Notas fiscais", "/notas"],
      ["Fila de Checagem", "/checagem"], ["Clientes", "/clientes"], ["Alertas de Cobrança", "/alertas"], ["CRM", "/crm"], ["Tarefas", "/operacao"], ["Modelos de contrato", "/modelos-contrato"], ["Equipe", "/equipe"]
    ]);
    expect(rotulo).toBe("(Administrador)");
  });

  it("financeiro: tudo menos Equipe", () => {
    const { itens } = links("financeiro");
    expect(itens.map(([, href]) => href)).toEqual(["/", "/painel", "/contratos", "/notas", "/checagem", "/clientes", "/alertas"]);
  });

  it("vendas: Início + CRM — nenhuma tela financeira", () => {
    expect(links("vendas").itens).toEqual([["Início", "/"], ["CRM", "/crm"]]);
  });

  it("rh: só Início", () => {
    expect(links("rh").itens).toEqual([["Início", "/"]]);
  });
});
