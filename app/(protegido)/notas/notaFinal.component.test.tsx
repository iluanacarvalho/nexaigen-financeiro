// Tela de Notas — nota FINAL de aviso prévio (rodada 12-A): quadro
// "Contratos em aviso prévio" com o aviso de cada contrato, botão "Criar
// nota final" abrindo o formulário de MENSALIDADE com cliente, competência
// do último período e valor proporcional (editável); botão some quando a
// nota do período já existe; link vindo de Clientes (?nota_final=<id>);
// 409 de competência depois do término aparece no formulário. Fetch falso.

import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";
import NotasPage from "./page";

const BASE = {
  uf: "PR", plano: "dispensa", taxa_implantacao: null, tem_implantacao_ativa: false, data_inicio_contrato: "2026-01-01",
  cancelamento_pedido_em: null, cancelamento_termino_em: null, cancelamento_motivo: null
};
// Período 31/01–01/03/2026, término 15/02 → 16 dias de R$ 8.500,00 → R$ 4.533,33, competência 01/2026.
const EM_AVISO = {
  ...BASE, id: "c2", nome: "Prefeitura de Beta", valor_mensal: "8500.00", status_contrato: "em_aviso_previo",
  cancelamento_pedido_em: "2026-01-16", cancelamento_termino_em: "2026-02-15", cancelamento_motivo: "Ofício", nota_final_emitida: false
};
const ATIVO = { ...BASE, id: "c1", nome: "Prefeitura de Alfa", valor_mensal: "5457.00", status_contrato: "ativo" };
const SUSPENSO = { ...BASE, id: "c9", nome: "Prefeitura de Ômega", valor_mensal: "100.00", status_contrato: "suspenso" };

afterEach(() => window.history.replaceState(null, "", "/"));

describe("Notas — nota final de aviso prévio", () => {
  it("quadro de aviso prévio → 'Criar nota final' abre mensalidade com competência do último período e valor proporcional editável", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/notas": { corpo: { notas: [], total: 0 } },
      "GET /api/clientes": { corpo: { clientes: [ATIVO, EM_AVISO, SUSPENSO] } },
      "POST /api/notas": { status: 201, corpo: { id: "nova" } }
    });
    const usuario = userEvent.setup();
    render(<NotasPage />);

    const quadro = await screen.findByRole("region", { name: "Contratos em aviso prévio" });
    expect(within(quadro).getByRole("status", { name: "Aviso prévio" }).textContent).toContain("Contrato em aviso prévio — término em 15/02/2026");
    expect(within(quadro).queryByText(/Alfa/)).toBeNull();

    await usuario.click(within(quadro).getByRole("button", { name: "Criar nota final" }));
    const form = screen.getByRole("form", { name: "Nova nota fiscal" });
    expect((within(form).getByLabelText("Tipo da nota") as HTMLSelectElement).value).toBe("mensalidade");
    const cliente = within(form).getByLabelText("Cliente (contrato ativo ou em aviso prévio)") as HTMLSelectElement;
    expect(cliente.value).toBe("c2");
    // Suspenso fora; ativo e em aviso dentro.
    expect(within(cliente).getAllByRole("option").map((o) => o.textContent)).toEqual(["Selecione…", "Prefeitura de Alfa — PR", "Prefeitura de Beta — PR"]);
    expect((within(form).getByLabelText("Competência (mês)") as HTMLInputElement).value).toBe("2026-01");
    const valor = within(form).getByLabelText(/Valor/) as HTMLInputElement;
    expect(valor.value).toBe("4533,33");
    expect(form.textContent).toMatch(/16 dias do período 31\/01\/2026–01\/03\/2026 \(término em 15\/02\/2026\)/);

    // Editável: o combinado pode ser outro.
    await usuario.clear(valor);
    await usuario.type(valor, "4500,00");
    await usuario.click(within(form).getByRole("button", { name: "Criar nota" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST")).toBe(true));
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toMatchObject({ cliente_id: "c2", tipo: "mensalidade", competencia: "2026-01", valor: "4500,00" });
  });

  it("nota do último período já existe: aviso continua, botão some", async () => {
    instalarFetchFalso({
      "GET /api/notas": { corpo: { notas: [], total: 0 } },
      "GET /api/clientes": { corpo: { clientes: [{ ...EM_AVISO, nota_final_emitida: true }] } }
    });
    render(<NotasPage />);
    const quadro = await screen.findByRole("region", { name: "Contratos em aviso prévio" });
    expect(within(quadro).getByRole("status", { name: "Aviso prévio" })).toBeTruthy();
    expect(within(quadro).queryByRole("button", { name: "Criar nota final" })).toBeNull();
  });

  it("encerrado sem nota final continua no quadro (o job pode ter encerrado antes da emissão) e entra na lista de clientes do formulário", async () => {
    instalarFetchFalso({
      "GET /api/notas": { corpo: { notas: [], total: 0 } },
      "GET /api/clientes": { corpo: { clientes: [{ ...EM_AVISO, status_contrato: "encerrado" }] } }
    });
    const usuario = userEvent.setup();
    render(<NotasPage />);
    const quadro = await screen.findByRole("region", { name: "Contratos em aviso prévio" });
    expect(within(quadro).getByRole("status", { name: "Aviso prévio" }).textContent).toContain("Contrato encerrado — aviso prévio terminou em 15/02/2026");
    await usuario.click(within(quadro).getByRole("button", { name: "Criar nota final" }));
    expect((within(screen.getByRole("form", { name: "Nova nota fiscal" })).getByLabelText("Cliente (contrato ativo ou em aviso prévio)") as HTMLSelectElement).value).toBe("c2");
  });

  it("link vindo de Clientes (?nota_final=c2) já abre o formulário preenchido", async () => {
    window.history.replaceState(null, "", "/notas?nota_final=c2");
    instalarFetchFalso({ "GET /api/notas": { corpo: { notas: [], total: 0 } }, "GET /api/clientes": { corpo: { clientes: [EM_AVISO] } } });
    render(<NotasPage />);
    const form = await screen.findByRole("form", { name: "Nova nota fiscal" });
    expect((within(form).getByLabelText("Competência (mês)") as HTMLInputElement).value).toBe("2026-01");
    expect((within(form).getByLabelText(/Valor/) as HTMLInputElement).value).toBe("4533,33");
  });

  it("409 (competência depois do término) aparece no formulário", async () => {
    instalarFetchFalso({
      "GET /api/notas": { corpo: { notas: [], total: 0 } },
      "GET /api/clientes": { corpo: { clientes: [EM_AVISO] } },
      "POST /api/notas": { status: 409, corpo: { erro: "O contrato termina em 15/02/2026 (aviso prévio) — a última competência que pode ser cobrada é 01/2026." } }
    });
    const usuario = userEvent.setup();
    render(<NotasPage />);
    await usuario.click(within(await screen.findByRole("region", { name: "Contratos em aviso prévio" })).getByRole("button", { name: "Criar nota final" }));
    const form = screen.getByRole("form", { name: "Nova nota fiscal" });
    await usuario.click(within(form).getByRole("button", { name: "Criar nota" }));
    expect((await within(form).findByRole("alert")).textContent).toMatch(/última competência que pode ser cobrada é 01\/2026/);
  });
});
