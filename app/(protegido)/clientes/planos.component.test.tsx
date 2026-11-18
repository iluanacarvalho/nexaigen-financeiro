// Tela de Clientes — planos por porte (rodada 11-A): escolher o plano
// preenche o valor (editável) com a nota do padrão; quadro de habitantes e
// taxa de implantação só nos 3 portes; Dispensa sem taxa; num cliente
// existente, trocar de plano só repõe os padrões depois de confirmar;
// selo "Implantação a cobrar". Fetch falso.

import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";
import ClientesPage from "./page";

const BASE = {
  uf: "PR", cnpj: null, dia_vencimento_contrato: 5, data_inicio_contrato: "2026-01-01", status_contrato: "ativo", sistema_portal: null, portal_url: null,
  portal_usuario: null, contato_nome: null, contato_email: null, contato_telefone: null, observacao: null, contrato_arquivo_chave: null, contrato_arquivo_nome: null,
  municipio_id_externo: null, created_at: "2026-01-01T00:00:00.000Z", contrato_versao_atual: null
};
const PEQUENO = { ...BASE, id: "c1", nome: "Prefeitura de Alfa", plano: "pequeno_porte", valor_mensal: "8000.00", taxa_implantacao: "14000.00", tem_implantacao_ativa: false };
const MEDIO_JA_COBRADO = { ...BASE, id: "c2", nome: "Prefeitura de Beta", plano: "medio_porte", valor_mensal: "15000.00", taxa_implantacao: "20000.00", tem_implantacao_ativa: true };
const DISPENSA = { ...BASE, id: "c3", nome: "Prefeitura de Gama", plano: "dispensa", valor_mensal: "5457.00", taxa_implantacao: null, tem_implantacao_ativa: false };

const valorMensal = () => screen.getByLabelText(/^Valor mensal \(R\$\)/) as HTMLInputElement;
const taxa = () => screen.queryByLabelText(/^Taxa de implantação e treinamento \(R\$\)/) as HTMLInputElement | null;

describe("Clientes — escolher o plano (cliente novo)", () => {
  it("cada plano preenche a mensalidade padrão e mostra a faixa de habitantes (16-A2: inclusive a Dispensa); taxa só nos 3 portes", async () => {
    instalarFetchFalso({ "GET /api/clientes": { corpo: { clientes: [] } } });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    await usuario.click(await screen.findByRole("button", { name: "+ Novo cliente" }));
    const plano = screen.getByLabelText(/^Plano/) as HTMLSelectElement;

    expect(Array.from(plano.options).map((o) => o.textContent)).toEqual(["Dispensa", "Pequeno Porte", "Médio Porte", "Grande Porte"]);
    // Novo cliente começa em Dispensa: mensalidade padrão, faixa "Menos de 10 mil hab." e SEM taxa.
    expect(valorMensal().value).toBe("5457,00");
    expect(screen.getByText("Valor padrão do plano: R$ 5.457,00 — você pode alterar.", { exact: false })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Porte do município" })).getByText("Dispensa — Menos de 10 mil hab.")).toBeTruthy();
    expect(taxa()).toBeNull();

    for (const [rotulo, mensal, faixa, taxaPadrao] of [
      ["Pequeno Porte", "8500,00", "Pequeno Porte — 10 mil a menos de 50 mil hab.", "15000,00"],
      ["Médio Porte", "15000,00", "Médio Porte — 50 mil a menos de 200 mil hab.", "20000,00"],
      ["Grande Porte", "35000,00", "Grande Porte — 200 mil hab. ou mais", "30000,00"]
    ]) {
      await usuario.selectOptions(plano, rotulo);
      expect(valorMensal().value).toBe(mensal);
      expect(within(screen.getByRole("region", { name: "Porte do município" })).getByText(faixa)).toBeTruthy();
      expect(taxa()!.value).toBe(taxaPadrao);
    }

    await usuario.selectOptions(plano, "Dispensa");
    expect(taxa()).toBeNull();
    expect(within(screen.getByRole("region", { name: "Porte do município" })).getByText("Dispensa — Menos de 10 mil hab.")).toBeTruthy();
  });

  it("o valor continua editável e vai pro servidor como TEXTO; Dispensa nunca manda taxa", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/clientes": { corpo: { clientes: [] } }, "POST /api/clientes": { corpo: { id: "novo" } } });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    await usuario.click(await screen.findByRole("button", { name: "+ Novo cliente" }));
    await usuario.type(screen.getByLabelText("Nome da prefeitura"), "Prefeitura Nova");
    await usuario.type(screen.getByLabelText("UF"), "SP");
    await usuario.type(screen.getByLabelText("Data de início do contrato"), "2026-11-01");
    await usuario.clear(valorMensal());
    await usuario.type(valorMensal(), "5000,00");
    await usuario.click(screen.getByRole("button", { name: "Salvar cliente" }));

    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST")).toBe(true));
    const corpo = chamadas.find((c) => c.metodo === "POST")!.corpo as Record<string, unknown>;
    expect(corpo).toMatchObject({ plano: "dispensa", valor_mensal: "5000,00" });
    expect("taxa_implantacao" in corpo && corpo.taxa_implantacao !== undefined).toBe(false);
  });
});

describe("Clientes — trocar o plano de um cliente existente", () => {
  it("pede confirmação; 'Manter o plano atual' não muda nada; confirmar repõe os padrões e o PATCH leva plano + valores", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/clientes": { corpo: { clientes: [PEQUENO] } }, "PATCH /api/clientes/c1": { corpo: { id: "c1" } } });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    await usuario.click(await screen.findByRole("button", { name: "Editar" }));

    // Valores combinados (não os padrões) aparecem na edição.
    expect(valorMensal().value).toBe("8000,00");
    expect(taxa()!.value).toBe("14000,00");

    await usuario.selectOptions(screen.getByLabelText(/^Plano/), "Grande Porte");
    const dialogo = screen.getByRole("dialog", { name: "Confirmar troca de plano" });
    expect(dialogo.textContent).toMatch(/de Pequeno Porte para Grande Porte/);
    expect(dialogo.textContent).toMatch(/R\$\s*35\.000,00/);
    expect(valorMensal().value).toBe("8000,00"); // nada muda antes de confirmar
    expect((screen.getByRole("button", { name: "Salvar alterações" }) as HTMLButtonElement).disabled).toBe(true);

    await usuario.click(within(dialogo).getByRole("button", { name: "Manter o plano atual" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByLabelText(/^Plano/) as HTMLSelectElement).value).toBe("pequeno_porte");
    expect(valorMensal().value).toBe("8000,00");

    await usuario.selectOptions(screen.getByLabelText(/^Plano/), "Grande Porte");
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar troca de plano" }));
    expect(valorMensal().value).toBe("35000,00");
    expect(taxa()!.value).toBe("30000,00");

    await usuario.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(true));
    expect(chamadas.find((c) => c.metodo === "PATCH")!.corpo).toMatchObject({ plano: "grande_porte", valor_mensal: "35000,00", taxa_implantacao: "30000,00" });
  });

  it("mudar pra Dispensa: confirmação avisa que a taxa deixa de existir e o PATCH manda taxa null", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/clientes": { corpo: { clientes: [PEQUENO] } }, "PATCH /api/clientes/c1": { corpo: { id: "c1" } } });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    await usuario.click(await screen.findByRole("button", { name: "Editar" }));
    await usuario.selectOptions(screen.getByLabelText(/^Plano/), "Dispensa");
    expect(screen.getByRole("dialog").textContent).toMatch(/taxa de implantação deixa de existir/);
    await usuario.click(screen.getByRole("button", { name: "Confirmar troca de plano" }));
    expect(taxa()).toBeNull();
    await usuario.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(true));
    expect(chamadas.find((c) => c.metodo === "PATCH")!.corpo).toMatchObject({ plano: "dispensa", valor_mensal: "5457,00", taxa_implantacao: null });
  });
});

describe("Clientes — lista", () => {
  it("plano pelo rótulo; selo 'Implantação a cobrar' + link só pra quem tem taxa e ainda não tem nota de implantação", async () => {
    instalarFetchFalso({ "GET /api/clientes": { corpo: { clientes: [PEQUENO, MEDIO_JA_COBRADO, DISPENSA] } } });
    render(<ClientesPage />);
    const linha = async (id: string) => await screen.findByTestId(`cliente-${id}`);

    const alfa = await linha("c1");
    expect(within(alfa).getByText("Pequeno Porte")).toBeTruthy();
    expect(within(alfa).getByText(/Implantação a cobrar — R\$\s*14\.000,00/)).toBeTruthy();
    expect(within(alfa).getByRole("link", { name: "Criar nota de implantação" }).getAttribute("href")).toBe("/notas?implantacao=c1");

    expect(within(await linha("c2")).queryByText(/Implantação a cobrar/)).toBeNull();
    expect(within(await linha("c3")).queryByText(/Implantação a cobrar/)).toBeNull();
    expect(within(await linha("c3")).getByText("Dispensa")).toBeTruthy();
  });
});
