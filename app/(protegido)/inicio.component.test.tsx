// Página inicial por papel (rodada 15-A): admin/financeiro → Dashboard;
// vendas/rh → só as boas-vindas, sem nenhum número financeiro. Sessão e
// resumo do Dashboard mockados.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { contextoMock, resumoMock } = vi.hoisted(() => ({ contextoMock: vi.fn(), resumoMock: vi.fn() }));
// (resumoMock: prova que vendas/rh nem chegam a consultar os números do Dashboard)
vi.mock("@/lib/authPagina", () => ({ contextoDaPagina: contextoMock }));
vi.mock("@/lib/resumoDashboard", () => ({ obterResumoDashboard: resumoMock }));

import Dashboard from "./Dashboard";
import Inicio from "./page";

describe("página inicial por papel", () => {
  it.each([
    ["vendas", "Seu acesso de vendas tem o CRM: o funil das prefeituras que você está prospectando, com histórico e próximas ações."],
    ["rh", "Seu acesso de RH ainda não tem módulos."]
  ])("%s: boas-vindas, nenhum dado financeiro, nem consulta o resumo", async (papel, texto) => {
    contextoMock.mockResolvedValue({ equipeId: "e", nome: "Bia", precisaTrocarSenha: false, papel });
    render(await Inicio());
    expect(screen.getByRole("heading", { name: "Bem-vindo, Bia" })).toBeTruthy();
    expect(screen.getByText(texto)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/R\$|Dashboard Financeiro/);
    expect(resumoMock).not.toHaveBeenCalled();
  });

  it("financeiro: Dashboard", async () => {
    contextoMock.mockResolvedValue({ equipeId: "e", nome: "Ana", precisaTrocarSenha: false, papel: "financeiro" });
    // A página devolve o elemento do Dashboard (componente assíncrono, testado em dashboard.component.test.tsx).
    const elemento = await Inicio();
    expect(elemento.type).toBe(Dashboard);
  });

  it("vendas: link pro CRM; rh: nenhum link de módulo", async () => {
    contextoMock.mockResolvedValue({ equipeId: "e", nome: "Bia", precisaTrocarSenha: false, papel: "vendas" });
    const { unmount } = render(await Inicio());
    expect(screen.getByRole("link", { name: "Abrir o CRM" }).getAttribute("href")).toBe("/crm");
    unmount();
    contextoMock.mockResolvedValue({ equipeId: "e", nome: "Rui", precisaTrocarSenha: false, papel: "rh" });
    render(await Inicio());
    expect(screen.queryByRole("link")).toBeNull();
  });
});
