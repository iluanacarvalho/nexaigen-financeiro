// Tela de Clientes — cancelamento com aviso prévio (rodada 12-A): selo do
// status em português, "Registrar cancelamento" com confirmação EXPLÍCITA
// mostrando o término calculado, "Retratar cancelamento" com confirmação,
// aviso "Contrato em aviso prévio — término em …" e o botão "Criar nota
// final" (some quando a nota do último período já existe). Fetch falso.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { somarDias } from "@/lib/estadoNota";
import ClientesPage from "./page";

const HOJE = hojeEmSaoPaulo(new Date());
const br = (iso: string) => iso.split("-").reverse().join("/");

const BASE = {
  uf: "PR", plano: "dispensa", valor_mensal: "8500.00", sistema_portal: null, contrato_arquivo_nome: null, contrato_versao_atual: null, taxa_implantacao: null,
  data_inicio_contrato: "2026-01-01", cancelamento_pedido_em: null, cancelamento_termino_em: null, cancelamento_motivo: null
};
const ATIVO = { ...BASE, id: "c1", nome: "Prefeitura de Alfa", status_contrato: "ativo" };
// Em aviso com término daqui a 10 dias (retratação ainda possível).
const PEDIDO_RECENTE = somarDias(HOJE, -20);
const EM_AVISO = {
  ...BASE, id: "c2", nome: "Prefeitura de Beta", status_contrato: "em_aviso_previo",
  cancelamento_pedido_em: PEDIDO_RECENTE, cancelamento_termino_em: somarDias(PEDIDO_RECENTE, 30), cancelamento_motivo: "Ofício 1", nota_final_emitida: false
};
// Encerrado por aviso prévio: período 31/01–01/03, término 15/02 → 16 dias → R$ 4.533,33, competência 01/2026.
const ENCERRADO_SEM_NOTA_FINAL = {
  ...BASE, id: "c3", nome: "Prefeitura de Gama", status_contrato: "encerrado",
  cancelamento_pedido_em: "2026-01-16", cancelamento_termino_em: "2026-02-15", cancelamento_motivo: "Ofício 2", nota_final_emitida: false
};

function linha(nome: string): HTMLElement {
  return screen.getByText(`${nome} — PR`).closest("tr")!;
}

describe("Clientes — status do contrato e aviso prévio", () => {
  it("selo com rótulo em português; ações certas por status; aviso com nota final e link pra Notas", async () => {
    instalarFetchFalso({ "GET /api/clientes": { corpo: { clientes: [ATIVO, EM_AVISO, ENCERRADO_SEM_NOTA_FINAL] } } });
    render(<ClientesPage />);
    await screen.findByText("Prefeitura de Alfa — PR");

    expect(within(linha("Prefeitura de Alfa")).getByTestId("selo-status-contrato").textContent).toBe("Ativo");
    expect(within(linha("Prefeitura de Alfa")).getByRole("button", { name: "Registrar cancelamento" })).toBeTruthy();
    expect(within(linha("Prefeitura de Alfa")).queryByRole("status", { name: "Aviso prévio" })).toBeNull();

    const beta = linha("Prefeitura de Beta");
    expect(within(beta).getByTestId("selo-status-contrato").textContent).toBe("Em aviso prévio");
    expect(within(beta).getByRole("status", { name: "Aviso prévio" }).textContent).toContain(`Contrato em aviso prévio — término em ${br(EM_AVISO.cancelamento_termino_em)}`);
    expect(within(beta).getByRole("button", { name: "Retratar cancelamento" })).toBeTruthy();
    expect(within(beta).queryByRole("button", { name: "Registrar cancelamento" })).toBeNull();
    expect(within(beta).getByRole("link", { name: "Criar nota final" }).getAttribute("href")).toBe("/notas?nota_final=c2");

    const gama = linha("Prefeitura de Gama");
    expect(within(gama).getByTestId("selo-status-contrato").textContent).toBe("Encerrado");
    const avisoGama = within(gama).getByRole("status", { name: "Aviso prévio" });
    expect(avisoGama.textContent).toContain("Contrato encerrado — aviso prévio terminou em 15/02/2026");
    expect(avisoGama.textContent).toMatch(/Nota final: R\$\s*4\.533,33 \(16 dias, competência 01\/2026\)/);
    expect(within(gama).queryByRole("button", { name: /cancelamento/ })).toBeNull();
  });

  it("nota final já emitida: o aviso continua, o botão 'Criar nota final' some", async () => {
    instalarFetchFalso({ "GET /api/clientes": { corpo: { clientes: [{ ...EM_AVISO, nota_final_emitida: true }] } } });
    render(<ClientesPage />);
    const beta = (await screen.findByText("Prefeitura de Beta — PR")).closest("tr")!;
    expect(within(beta).getByRole("status", { name: "Aviso prévio" })).toBeTruthy();
    expect(within(beta).queryByRole("link", { name: "Criar nota final" })).toBeNull();
  });
});

describe("Clientes — registrar cancelamento", () => {
  it("data do ofício + motivo → confirmação mostra o término (pedido + 30) → POST com os dados → recarrega", async () => {
    let posts = 0;
    const chamadas = instalarFetchFalso({
      "GET /api/clientes": () => ({ corpo: { clientes: posts === 0 ? [ATIVO] : [{ ...ATIVO, status_contrato: "em_aviso_previo" }] } }),
      "POST /api/clientes/c1/cancelamento": () => {
        posts += 1;
        return { corpo: { statusContrato: "em_aviso_previo" } };
      }
    });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    await usuario.click(await screen.findByRole("button", { name: "Registrar cancelamento" }));

    const dialogo = screen.getByRole("dialog", { name: "Registrar cancelamento" });
    const pedido = somarDias(HOJE, -3);
    fireEvent.change(within(dialogo).getByLabelText("Data de recebimento do ofício"), { target: { value: pedido } });
    await usuario.type(within(dialogo).getByLabelText(/^Motivo \(obrigatório\)/), "Ofício 45/2026 — troca de gestão");
    await usuario.click(within(dialogo).getByRole("button", { name: "Continuar" }));

    expect(dialogo.textContent).toContain(`Ofício recebido em ${br(pedido)} → término em ${br(somarDias(pedido, 30))}`);
    expect(dialogo.textContent).toMatch(/mensalidade continua devida/);
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false); // nada enviado antes da confirmação

    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar cancelamento" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Registrar cancelamento" })).toBeNull());
    const post = chamadas.find((c) => c.metodo === "POST")!;
    expect(post.corpo).toEqual({ dataPedido: pedido, motivo: "Ofício 45/2026 — troca de gestão" });
    await waitFor(() => expect(within(linha("Prefeitura de Alfa")).getByTestId("selo-status-contrato").textContent).toBe("Em aviso prévio"));
  });

  it("validação antes de confirmar: sem motivo e data no futuro são recusados na tela; ofício antigo avisa que encerra na hora", async () => {
    instalarFetchFalso({ "GET /api/clientes": { corpo: { clientes: [ATIVO] } } });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    await usuario.click(await screen.findByRole("button", { name: "Registrar cancelamento" }));
    const dialogo = screen.getByRole("dialog", { name: "Registrar cancelamento" });

    await usuario.click(within(dialogo).getByRole("button", { name: "Continuar" }));
    expect(within(dialogo).getByRole("alert").textContent).toBe("Informe o motivo do cancelamento.");

    await usuario.type(within(dialogo).getByLabelText(/^Motivo \(obrigatório\)/), "x");
    fireEvent.change(within(dialogo).getByLabelText("Data de recebimento do ofício"), { target: { value: somarDias(HOJE, 1) } });
    await usuario.click(within(dialogo).getByRole("button", { name: "Continuar" }));
    expect(within(dialogo).getByRole("alert").textContent).toMatch(/não pode estar no futuro/);

    fireEvent.change(within(dialogo).getByLabelText("Data de recebimento do ofício"), { target: { value: somarDias(HOJE, -40) } });
    await usuario.click(within(dialogo).getByRole("button", { name: "Continuar" }));
    expect(dialogo.textContent).toMatch(/O término já passou — o contrato será ENCERRADO imediatamente/);
  });

  it("409 do servidor aparece no diálogo", async () => {
    instalarFetchFalso({
      "GET /api/clientes": { corpo: { clientes: [ATIVO] } },
      "POST /api/clientes/c1/cancelamento": { status: 409, corpo: { erro: "Este contrato já está em aviso prévio — retrate o cancelamento atual antes de registrar outro." } }
    });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    await usuario.click(await screen.findByRole("button", { name: "Registrar cancelamento" }));
    const dialogo = screen.getByRole("dialog", { name: "Registrar cancelamento" });
    await usuario.type(within(dialogo).getByLabelText(/^Motivo \(obrigatório\)/), "x");
    await usuario.click(within(dialogo).getByRole("button", { name: "Continuar" }));
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar cancelamento" }));
    expect((await within(dialogo).findByRole("alert")).textContent).toMatch(/já está em aviso prévio/);
  });
});

describe("Clientes — retratar cancelamento", () => {
  it("confirmação mostra o término; só depois do clique o DELETE vai", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/clientes": { corpo: { clientes: [EM_AVISO] } },
      "DELETE /api/clientes/c2/cancelamento": { corpo: { statusContrato: "ativo" } }
    });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    await usuario.click(await screen.findByRole("button", { name: "Retratar cancelamento" }));
    const dialogo = screen.getByRole("dialog", { name: "Retratar cancelamento" });
    expect(dialogo.textContent).toContain(`O contrato volta a ficar ativo (o aviso prévio terminaria em ${br(EM_AVISO.cancelamento_termino_em)})`);
    expect(chamadas.some((c) => c.metodo === "DELETE")).toBe(false);

    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar retratação" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "DELETE" && c.url === "/api/clientes/c2/cancelamento")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Retratar cancelamento" })).toBeNull());
  });

  it("depois do término não há botão de retratar", async () => {
    instalarFetchFalso({
      "GET /api/clientes": { corpo: { clientes: [{ ...EM_AVISO, cancelamento_pedido_em: somarDias(HOJE, -31), cancelamento_termino_em: somarDias(HOJE, -1) }] } }
    });
    render(<ClientesPage />);
    const beta = (await screen.findByText("Prefeitura de Beta — PR")).closest("tr")!;
    expect(within(beta).queryByRole("button", { name: "Retratar cancelamento" })).toBeNull();
  });
});
