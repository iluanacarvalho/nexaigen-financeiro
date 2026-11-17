// Relatório "Novos contratos" (rodada 15-A): cartões com variação e saldo
// líquido, tabela ordenável, links de exportação reais, gráfico e estado
// vazio honesto. Server Component: o teste chama a página e renderiza o
// JSX; a leitura do banco é mockada, os NÚMEROS vêm da função pura real.

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { obterMock } = vi.hoisted(() => ({ obterMock: vi.fn() }));
vi.mock("@/lib/relatorioContratosRepositorio", () => ({ obterRelatorioContratos: obterMock }));

import { montarRelatorioContratos, type LinhaClienteRelatorio } from "@/lib/relatorioContratos";
import ContratosPage from "./page";

const cliente = (extra: Partial<LinhaClienteRelatorio>): LinhaClienteRelatorio => ({
  id: "x", nome: "P", uf: "PR", plano: "dispensa", valor_mensal: "1000.00", status_contrato: "ativo", taxa_implantacao: null,
  tem_implantacao_ativa: false, cancelamento_termino_em: null, data_inicio_contrato: "2026-10-05", municipio_id_externo: null, ...extra
});

const CLIENTES = [
  cliente({ id: "a", nome: "Prefeitura de Beta", uf: "SP", valor_mensal: "8500.00", plano: "pequeno_porte", taxa_implantacao: "15000.00", data_inicio_contrato: "2026-10-20", municipio_id_externo: "m" }),
  cliente({ id: "b", nome: "Prefeitura de Alfa", valor_mensal: "5457.00", data_inicio_contrato: "2026-10-02" }),
  cliente({ id: "c", nome: "Prefeitura de Setembro", data_inicio_contrato: "2026-09-10" }),
  cliente({ id: "d", nome: "Prefeitura Encerrada", valor_mensal: "700.00", data_inicio_contrato: "2025-01-01", status_contrato: "encerrado" })
];

function relatorio(mes: string) {
  return montarRelatorioContratos({ clientes: CLIENTES, eventos: [{ cliente_id: "d", tipo: "contrato_encerrado", data_evento: "2026-10-15", criado_em: "2026-10-15T10:00:00.000Z" }], mes, hoje: "2026-11-17" });
}

function card(titulo: string): HTMLElement {
  return screen.getByText(titulo, { selector: "p" }).parentElement!;
}

describe("Novos contratos", () => {
  it("cartões, variação, saldo líquido, MRR da carteira, exportação e tabela ordenável", async () => {
    obterMock.mockResolvedValue(relatorio("2026-10"));
    const usuario = userEvent.setup();
    render(await ContratosPage({ searchParams: Promise.resolve({ mes: "2026-10" }) }));

    expect(obterMock).toHaveBeenCalledWith("2026-10", expect.any(Date));
    expect(screen.getByText(/A vigência começa na assinatura/)).toBeTruthy();
    expect(card("Novos contratos").textContent).toMatch(/^Novos contratos2/);
    expect(card("Novos contratos").textContent).toContain("09/2026: 1 · variação +1 (+100%)");
    expect(card("MRR novo").textContent).toMatch(/R\$\s*13\.957,00/);
    expect(card("Implantação a cobrar dos novos").textContent).toMatch(/R\$\s*15\.000,00/);
    expect(card("Contratos encerrados no mês").textContent).toMatch(/^Contratos encerrados no mês1/);
    expect(card("Saldo líquido (novos − encerrados)").textContent).toMatch(/\+1/);
    expect(card("Saldo líquido (novos − encerrados)").textContent).toMatch(/mesma conta do Painel/);
    expect(screen.getByRole("link", { name: "Exportar CSV" }).getAttribute("href")).toBe("/api/relatorios/novos-contratos?mes=2026-10&formato=csv");
    expect(screen.getByRole("link", { name: "Exportar XLSX" }).getAttribute("href")).toBe("/api/relatorios/novos-contratos?mes=2026-10&formato=xlsx");
    expect(screen.getByRole("img", { name: "Novos contratos e MRR novo acumulado por mês" })).toBeTruthy();

    const tabela = screen.getByRole("table", { name: "Contratos novos do mês" });
    const nomes = () => within(tabela).getAllByRole("row").slice(1).map((l) => l.querySelector("td")!.textContent);
    expect(nomes()).toEqual(["Prefeitura de Alfa", "Prefeitura de Beta"]); // por data de início
    const beta = within(tabela).getByText("Prefeitura de Beta").closest("tr")!;
    expect(beta.textContent).toContain("Pequeno Porte");
    expect(beta.textContent).toContain("20/10/2026");
    expect(beta.textContent).toContain("Integração Educa");
    expect(within(beta).getByTestId("selo-status-contrato").textContent).toBe("Ativo");
    await usuario.click(within(tabela).getByRole("button", { name: /Valor mensal/ }));
    await usuario.click(within(tabela).getByRole("button", { name: /Valor mensal/ }));
    expect(nomes()).toEqual(["Prefeitura de Beta", "Prefeitura de Alfa"]); // valor decrescente
  });

  it("mês sem contrato novo: mensagem honesta, '—' nos cartões de novos, sem tabela", async () => {
    obterMock.mockResolvedValue(relatorio("2026-08"));
    render(await ContratosPage({ searchParams: Promise.resolve({ mes: "2026-08" }) }));
    expect(screen.getByText("Nenhum contrato novo neste mês.")).toBeTruthy();
    expect(card("Novos contratos").textContent).toMatch(/^Novos contratos—/);
    expect(card("MRR novo").textContent).toMatch(/^MRR novo—/);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("mês inválido na URL: avisa e mostra o mês atual", async () => {
    obterMock.mockResolvedValue(relatorio("2026-11"));
    render(await ContratosPage({ searchParams: Promise.resolve({ mes: "2026-13" }) }));
    expect(screen.getByRole("alert").textContent).toMatch(/Mês inválido — use aaaa-mm\. Mostrando o mês atual/);
    expect(obterMock).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), expect.any(Date));
    expect(obterMock.mock.calls.at(-1)![0]).not.toBe("2026-13");
  });
});
