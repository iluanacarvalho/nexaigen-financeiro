// Tela de Notas — nota de IMPLANTAÇÃO (rodada 11-A): quadro "Implantação a
// cobrar", formulário aberto já preenchido (tipo, cliente, valor = taxa),
// sem campo de competência (é o mês da emissão), link vindo de Clientes
// (?implantacao=<id>), filtro e coluna "Tipo". Fetch falso.

import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";
import NotasPage from "./page";

const CLIENTES = [
  { id: "c1", nome: "Prefeitura de Alfa", uf: "PR", status_contrato: "ativo", plano: "medio_porte", taxa_implantacao: "20000.00", tem_implantacao_ativa: false },
  { id: "c2", nome: "Prefeitura de Beta", uf: "SP", status_contrato: "ativo", plano: "pequeno_porte", taxa_implantacao: "15000.00", tem_implantacao_ativa: true },
  { id: "c3", nome: "Prefeitura de Gama", uf: "MG", status_contrato: "ativo", plano: "dispensa", taxa_implantacao: null, tem_implantacao_ativa: false }
];

const NOTA_IMPLANTACAO = {
  id: "n9", tipo: "implantacao", cliente_id: "c2", numero_nf: "900", valor: "15000.00", competencia: "2026-10-01", data_emissao: "2026-10-05", data_atesto: null,
  data_limite_pagamento: null, data_pagamento: null, status: "aguardando_atesto", situacao: "aguardando_atesto", motivo_cancelamento: null, cancelado_em: null,
  arquivo_pdf_nome: null, arquivo_pdf_versao_atual: null, cliente: { id: "c2", nome: "Prefeitura de Beta", uf: "SP", sistema_portal: null, portal_url: null }
};

afterEach(() => window.history.replaceState(null, "", "/"));

describe("Notas — implantação a cobrar", () => {
  it("o quadro lista só quem tem taxa e nenhuma nota de implantação; o botão abre o formulário de implantação preenchido", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/notas": { corpo: { notas: [], total: 0 } },
      "GET /api/clientes": { corpo: { clientes: CLIENTES } },
      "POST /api/notas": { status: 201, corpo: { id: "nova" } }
    });
    const usuario = userEvent.setup();
    render(<NotasPage />);

    const quadro = await screen.findByRole("region", { name: "Implantação a cobrar" });
    expect(within(quadro).getByText(/Prefeitura de Alfa — PR · R\$\s*20\.000,00/)).toBeTruthy();
    expect(within(quadro).queryByText(/Beta/)).toBeNull();
    expect(within(quadro).queryByText(/Gama/)).toBeNull();

    await usuario.click(within(quadro).getByRole("button", { name: "Criar nota de implantação" }));
    const form = screen.getByRole("form", { name: "Nova nota fiscal" });
    expect((within(form).getByLabelText("Tipo da nota") as HTMLSelectElement).value).toBe("implantacao");
    expect((within(form).getByLabelText("Cliente (contrato ativo ou em aviso prévio)") as HTMLSelectElement).value).toBe("c1");
    expect((within(form).getByLabelText(/Valor/) as HTMLInputElement).value).toBe("20000,00");
    expect(within(form).queryByLabelText("Competência (mês)")).toBeNull();
    expect(within(form).getByText(/é o mês da data de emissão/)).toBeTruthy();

    await usuario.type(within(form).getByLabelText("Número da NF"), "NF-IMP-1");
    await usuario.click(within(form).getByRole("button", { name: "Criar nota de implantação" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST")).toBe(true));
    const corpo = chamadas.find((c) => c.metodo === "POST")!.corpo as Record<string, unknown>;
    expect(corpo).toMatchObject({ tipo: "implantacao", cliente_id: "c1", valor: "20000,00", numero_nf: "NF-IMP-1" });
    expect(corpo.competencia).toBeUndefined();
  });

  it("409 do servidor (implantação já existe) aparece no formulário", async () => {
    instalarFetchFalso({
      "GET /api/notas": { corpo: { notas: [], total: 0 } },
      "GET /api/clientes": { corpo: { clientes: CLIENTES } },
      "POST /api/notas": { status: 409, corpo: { erro: "Este cliente já tem uma nota de implantação ativa — a implantação é cobrada uma única vez (cancele a anterior, se ela foi emitida errada)." } }
    });
    const usuario = userEvent.setup();
    render(<NotasPage />);
    await usuario.click(within(await screen.findByRole("region", { name: "Implantação a cobrar" })).getByRole("button", { name: "Criar nota de implantação" }));
    const form = screen.getByRole("form", { name: "Nova nota fiscal" });
    await usuario.click(within(form).getByRole("button", { name: "Criar nota de implantação" }));
    expect((await within(form).findByRole("alert")).textContent).toMatch(/já tem uma nota de implantação ativa/);
  });

  it("link vindo da tela de Clientes (?implantacao=c1) já abre o formulário de implantação", async () => {
    window.history.replaceState(null, "", "/notas?implantacao=c1");
    instalarFetchFalso({ "GET /api/notas": { corpo: { notas: [], total: 0 } }, "GET /api/clientes": { corpo: { clientes: CLIENTES } } });
    render(<NotasPage />);
    const form = await screen.findByRole("form", { name: "Nova nota fiscal" });
    expect((within(form).getByLabelText("Tipo da nota") as HTMLSelectElement).value).toBe("implantacao");
    expect((within(form).getByLabelText(/Valor/) as HTMLInputElement).value).toBe("20000,00");
  });

  it("filtro 'Tipo' vai pro servidor e a coluna mostra o tipo", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/notas": { corpo: { notas: [NOTA_IMPLANTACAO], total: 1 } }, "GET /api/clientes": { corpo: { clientes: CLIENTES } } });
    const usuario = userEvent.setup();
    render(<NotasPage />);
    const linha = (await screen.findByText("900", { selector: "td" })).closest("tr")!;
    expect(within(linha).getByText("Implantação")).toBeTruthy();
    await usuario.selectOptions(screen.getByLabelText("Tipo"), "implantacao");
    await waitFor(() => expect(chamadas.some((c) => c.url.includes("tipo=implantacao"))).toBe(true));
  });
});
