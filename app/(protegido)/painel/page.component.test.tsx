// Painel financeiro — estado vazio honesto ("—", nunca zeros fingindo dado)
// e estado com dados. É Server Component assíncrono: o teste chama a página,
// espera o JSX e renderiza. A leitura do banco é mockada; os NÚMEROS vêm da
// função pura real (lib/painelFinanceiro.ts#montarPainelFinanceiro).

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const { obterPainelMock } = vi.hoisted(() => ({ obterPainelMock: vi.fn() }));
vi.mock("@/lib/painelFinanceiroRepositorio", () => ({ obterPainelFinanceiro: obterPainelMock }));

import { montarPainelFinanceiro } from "@/lib/painelFinanceiro";
import PainelPage from "./page";

const HOJE = "2026-10-29";

function card(titulo: string | RegExp): HTMLElement {
  return screen.getByText(titulo, { selector: "p" }).parentElement!;
}

describe("Painel financeiro", () => {
  it("banco vazio: cards com '—', aviso de estado vazio e gráfico sem barras zeradas", async () => {
    obterPainelMock.mockResolvedValue(montarPainelFinanceiro({ clientes: [], notas: [], hoje: HOJE }));
    render(await PainelPage());

    expect(screen.getByText(/Ainda não há notas fiscais em aberto nem faturadas/)).toBeTruthy();
    expect(card("Receita mensal recorrente (MRR)").textContent).toContain("—");
    expect(card(/^Recebido em/).textContent).toContain("—");
    expect(card("A receber").textContent).toContain("—");
    expect(card("Inadimplência (12 meses)").textContent).toContain("—");
    expect(card("Prazo médio de recebimento").textContent).toContain("—");
    expect(screen.getByText("Sem faturamento nem recebimento nos últimos 12 meses.")).toBeTruthy();
    expect(screen.getByText("Nenhum cliente cadastrado.")).toBeTruthy();
    expect(screen.getByText("Nenhuma taxa de implantação a cobrar, em aberto ou recebida nos últimos 12 meses.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/R\$\s*0,00/);
  });

  it("com dados: valores, situação do cliente, gráfico e link de exportação CSV", async () => {
    obterPainelMock.mockResolvedValue(
      montarPainelFinanceiro({
        hoje: HOJE,
        clientes: [{ id: "c1", nome: "Prefeitura de Zeta", uf: "RS", plano: "completo", valor_mensal: "4500.50", status_contrato: "ativo" }],
        notas: [
          // limite 2026-08-01 → 89 dias de atraso → atraso crítico, inadimplente
          { id: "n1", cliente_id: "c1", valor: "4500.50", competencia: "2026-07-01", status: "vencida", data_emissao: "2026-07-01", data_atesto: "2026-07-02", data_limite_pagamento: "2026-08-01", data_pagamento: null },
          { id: "n2", cliente_id: "c1", valor: "4500.50", competencia: "2026-09-01", status: "paga", data_emissao: "2026-09-01", data_atesto: "2026-09-05", data_limite_pagamento: "2026-10-05", data_pagamento: "2026-10-10" }
        ]
      })
    );
    render(await PainelPage());

    expect(card("Receita mensal recorrente (MRR)").textContent).toMatch(/R\$\s*4\.500,50/);
    expect(card(/^Recebido em/).textContent).toMatch(/R\$\s*4\.500,50/);
    expect(within(card("A receber")).getByText("Atraso crítico (≥60 dias)").nextElementSibling!.textContent).toMatch(/4\.500,50/);
    expect(card("Inadimplência (12 meses)").textContent).toContain("50%");
    expect(screen.getByRole("img", { name: "Faturado e recebido por mês" })).toBeTruthy();
    const linhaZeta = screen.getByText("Prefeitura de Zeta — RS").closest("tr")!;
    expect(within(linhaZeta).getByText("Inadimplente")).toBeTruthy();
    expect(within(linhaZeta).getByText("89 dias")).toBeTruthy();
    const csv = screen.getByRole("link", { name: "Exportar CSV" });
    expect(csv.getAttribute("href")).toBe("/api/painel-financeiro?formato=csv");
    expect(csv.hasAttribute("download")).toBe(true);
    expect(screen.queryByText(/Ainda não há notas fiscais/)).toBeNull();
  });

  it("implantação (única): quadro com a cobrar / a receber / recebida, selo no cliente e plano pelo rótulo", async () => {
    obterPainelMock.mockResolvedValue(
      montarPainelFinanceiro({
        hoje: HOJE,
        clientes: [
          { id: "c1", nome: "Prefeitura de Eta", uf: "SC", plano: "grande_porte", valor_mensal: "35000.00", status_contrato: "ativo", taxa_implantacao: "30000.00", tem_implantacao_ativa: false },
          { id: "c2", nome: "Prefeitura de Teta", uf: "SC", plano: "pequeno_porte", valor_mensal: "8500.00", status_contrato: "ativo", taxa_implantacao: "15000.00", tem_implantacao_ativa: true }
        ],
        notas: [{ id: "n1", cliente_id: "c2", tipo: "implantacao", valor: "15000.00", competencia: "2026-10-01", status: "aguardando_atesto", data_emissao: "2026-10-20", data_atesto: null, data_limite_pagamento: null, data_pagamento: null }]
      })
    );
    render(await PainelPage());

    const quadro = screen.getByRole("region", { name: "Implantação (única)" });
    expect(within(quadro).getByText("A cobrar (sem nota emitida)").nextElementSibling!.textContent).toMatch(/R\$\s*30\.000,00/);
    expect(within(quadro).getByText("1 cliente")).toBeTruthy();
    expect(within(quadro).getByText("A receber (nota emitida, em aberto)").nextElementSibling!.textContent).toMatch(/R\$\s*15\.000,00/);
    // MRR só com mensalidades (35.000 + 8.500), implantação fora.
    expect(card("Receita mensal recorrente (MRR)").textContent).toMatch(/R\$\s*43\.500,00/);
    const eta = screen.getByText("Prefeitura de Eta — SC").closest("tr")!;
    expect(within(eta).getByText("Grande Porte")).toBeTruthy();
    expect(within(eta).getByText(/Implantação a cobrar — R\$\s*30\.000,00/)).toBeTruthy();
  });
});

