// Tela de Clientes — contrato com versões (0009): versão atual, histórico
// com links reais, primeiro envio direto e substituição só com confirmação.

import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";
import ClientesPage from "./page";

const COM_CONTRATO = {
  id: "c1", nome: "Prefeitura de Delta", uf: "BA", plano: "completo", valor_mensal: "3000.00", sistema_portal: null, status_contrato: "ativo",
  contrato_arquivo_nome: "Contrato Delta 2026.pdf", contrato_versao_atual: 3
};
const SEM_CONTRATO = { ...COM_CONTRATO, id: "c2", nome: "Prefeitura de Épsilon", contrato_arquivo_nome: null, contrato_versao_atual: null };

describe("Clientes — versões do contrato", () => {
  it("mostra a versão atual e o histórico com download por versão (vindo da integração: autor não registrado)", async () => {
    instalarFetchFalso({
      "GET /api/clientes/c1/contrato/versoes": {
        corpo: {
          versoes: [
            { versao: 3, nome: "Contrato Delta 2026.pdf", tamanho_bytes: 5 * 1024 * 1024, sha256: "b".repeat(64), enviado_em: "2026-10-01T12:00:00.000Z", enviado_por_nome: null, motivo: "Enviado pela integração com o nexaigen-educa.", atual: true },
            { versao: 2, nome: "Contrato Delta 2025.pdf", tamanho_bytes: 1024, sha256: "c".repeat(64), enviado_em: "2025-10-01T12:00:00.000Z", enviado_por_nome: "Ana", motivo: null, atual: false }
          ]
        }
      },
      "GET /api/clientes": { corpo: { clientes: [COM_CONTRATO] } }
    });
    const usuario = userEvent.setup();
    render(<ClientesPage />);

    expect(await screen.findByText("Versão atual: v3")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Baixar contrato/ }).getAttribute("href")).toBe("/api/clientes/c1/contrato");
    await usuario.click(screen.getByText("Histórico de versões"));
    const v2 = await screen.findByRole("link", { name: "Contrato Delta 2025.pdf" });
    expect(v2.getAttribute("href")).toBe("/api/clientes/c1/contrato?versao=2");
    expect(v2.hasAttribute("download")).toBe(true);
    expect(screen.getByText("Motivo: Enviado pela integração com o nexaigen-educa.")).toBeTruthy();
    expect(screen.getByText(/5 MB/)).toBeTruthy();
  });

  it("primeiro contrato vai direto (sem confirmação); substituir pede confirmação", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/clientes": { corpo: { clientes: [COM_CONTRATO, SEM_CONTRATO] } },
      "POST /api/clientes/c2/contrato": { corpo: { ok: true, versao: 1 } },
      "POST /api/clientes/c1/contrato": { corpo: { ok: true, versao: 4 } }
    });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    await screen.findByText("Versão atual: v3");

    const [inputComContrato, inputSemContrato] = screen.getAllByLabelText("Arquivo PDF do contrato");
    await usuario.upload(inputSemContrato, new File(["%PDF-1.4"], "primeiro.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST" && c.url === "/api/clientes/c2/contrato")).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();

    await usuario.upload(inputComContrato, new File(["%PDF-1.4"], "aditivo.pdf", { type: "application/pdf" }));
    const dialogo = screen.getByRole("dialog", { name: "Confirmar nova versão do contrato" });
    expect(dialogo.textContent).toMatch(/Substituir o contrato atual \(v3\) por aditivo\.pdf/);
    expect(dialogo.textContent).toMatch(/A versão anterior será mantida no histórico/);
    expect(chamadas.some((c) => c.url === "/api/clientes/c1/contrato" && c.metodo === "POST")).toBe(false);
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar e enviar nova versão" }));
    await waitFor(() => expect(chamadas.some((c) => c.url === "/api/clientes/c1/contrato" && c.metodo === "POST")).toBe(true));
  });

  it("erro do servidor no envio aparece na linha", async () => {
    instalarFetchFalso({
      "GET /api/clientes": { corpo: { clientes: [SEM_CONTRATO] } },
      "POST /api/clientes/c2/contrato": { status: 502, corpo: { erro: "Armazenamento indisponível no momento — tente novamente em instantes." } }
    });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    await usuario.upload(await screen.findByLabelText("Arquivo PDF do contrato"), new File(["%PDF-1.4"], "c.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/Armazenamento indisponível/)).toBeTruthy();
  });
});
