// Tela Equipe — papel (rodada 15-A): coluna de papel, troca só depois de
// confirmar (avisando que as sessões caem), 409 do último admin aparece,
// trocar o PRÓPRIO papel manda pro /login, cadastro envia o papel.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

import EquipePage from "./page";

const COLEGAS = [
  { id: "e1", nome: "Luana", email: "luana@nexaigen.com.br", papel: "admin", ativo: true, criado_em: "2026-01-01T12:00:00.000Z" },
  { id: "e2", nome: "Bia", email: "bia@nexaigen.com.br", papel: "financeiro", ativo: true, criado_em: "2026-02-01T12:00:00.000Z" }
];

describe("Equipe — papéis", () => {
  it("mudar papel: confirmação explícita antes do PATCH; recarrega depois", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/equipe": { corpo: { colegas: COLEGAS } }, "PATCH /api/equipe/e2": { corpo: { papel: "vendas", mudou: true, sessaoEncerrada: false } } });
    const usuario = userEvent.setup();
    render(<EquipePage />);
    const select = (await screen.findByLabelText("Papel de Bia")) as HTMLSelectElement;
    expect(select.value).toBe("financeiro");
    await usuario.selectOptions(select, "vendas");

    const dialogo = screen.getByRole("dialog", { name: "Confirmar mudança de papel" });
    expect(dialogo.textContent).toMatch(/Mudar o papel de Bia de Financeiro para Vendas\?/);
    expect(dialogo.textContent).toMatch(/As sessões dela são encerradas agora/);
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(false);

    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar mudança de papel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(chamadas.find((c) => c.metodo === "PATCH")!.corpo).toEqual({ papel: "vendas" });
    expect(chamadas.filter((c) => c.metodo === "GET" && c.url === "/api/equipe")).toHaveLength(2);
  });

  it("409 do último admin aparece no diálogo; Voltar desfaz a escolha", async () => {
    instalarFetchFalso({
      "GET /api/equipe": { corpo: { colegas: COLEGAS } },
      "PATCH /api/equipe/e1": { status: 409, corpo: { erro: "Não é possível tirar o papel de administrador do último administrador ativo — promova outra pessoa a administrador antes." } }
    });
    const usuario = userEvent.setup();
    render(<EquipePage />);
    await usuario.selectOptions(await screen.findByLabelText("Papel de Luana"), "financeiro");
    const dialogo = screen.getByRole("dialog", { name: "Confirmar mudança de papel" });
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar mudança de papel" }));
    expect((await within(dialogo).findByRole("alert")).textContent).toMatch(/último administrador ativo/);
    await usuario.click(within(dialogo).getByRole("button", { name: "Voltar" }));
    expect((screen.getByLabelText("Papel de Luana") as HTMLSelectElement).value).toBe("admin");
  });

  it("mudar o PRÓPRIO papel: sessão encerrada → vai pro /login", async () => {
    pushMock.mockClear();
    instalarFetchFalso({ "GET /api/equipe": { corpo: { colegas: COLEGAS } }, "PATCH /api/equipe/e1": { corpo: { papel: "financeiro", mudou: true, sessaoEncerrada: true } } });
    const usuario = userEvent.setup();
    render(<EquipePage />);
    await usuario.selectOptions(await screen.findByLabelText("Papel de Luana"), "financeiro");
    await usuario.click(screen.getByRole("button", { name: "Confirmar mudança de papel" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login"));
  });

  it("cadastro envia o papel escolhido", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/equipe": { corpo: { colegas: COLEGAS } },
      "POST /api/equipe": { corpo: { id: "e3", email: "rh@nexaigen.com.br", papel: "rh", senhaTemporaria: "Temp-ABCD-EFGH", aviso: "Guarde esta senha." } }
    });
    const usuario = userEvent.setup();
    render(<EquipePage />);
    await screen.findByLabelText("Papel de Bia");
    await usuario.type(screen.getByLabelText("Nome completo"), "Carla RH");
    await usuario.type(screen.getByLabelText("E-mail"), "rh@nexaigen.com.br");
    const form = screen.getByRole("button", { name: "Cadastrar colega" }).closest("form")!;
    await usuario.selectOptions(within(form).getByLabelText(/^Papel/), "rh");
    expect(screen.getByText(/Vê: ainda nenhum módulo \(reservado para o RH\)/)).toBeTruthy();
    await usuario.click(screen.getByRole("button", { name: "Cadastrar colega" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST")).toBe(true));
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ nome: "Carla RH", email: "rh@nexaigen.com.br", papel: "rh" });
  });
});
