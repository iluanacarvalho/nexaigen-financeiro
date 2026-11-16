// Tela /notas — lista, filtros, criação com erro de validação do servidor,
// e confirmação das ações por linha. Fetch falso (testes/fetchFalso.ts),
// nenhum servidor real.

import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";
import type { NotaListada } from "@/lib/tipos";
import NotasPage from "./page";

const CLIENTE = { id: "c1", nome: "Prefeitura de Alfa", uf: "PR", sistema_portal: "Betha", portal_url: null };

function nota(extra: Partial<NotaListada>): NotaListada {
  return {
    id: "n1",
    tipo: "mensalidade",
    cliente_id: "c1",
    numero_nf: "100",
    valor: "1500.50",
    competencia: "2026-10-01",
    data_emissao: "2026-10-05",
    data_atesto: null,
    data_limite_pagamento: null,
    data_pagamento: null,
    status: "aguardando_atesto",
    situacao: "aguardando_atesto",
    motivo_cancelamento: null,
    cancelado_em: null,
    arquivo_pdf_nome: null,
    arquivo_pdf_versao_atual: null,
    cliente: CLIENTE,
    ...extra
  };
}

const NOTAS = [
  nota({ id: "n1", numero_nf: "100", situacao: "aguardando_atesto" }),
  nota({ id: "n2", numero_nf: "200", situacao: "atestada", data_atesto: "2026-10-10", data_limite_pagamento: "2026-11-09" }),
  nota({ id: "n3", numero_nf: "300", situacao: "paga", data_atesto: "2026-09-10", data_pagamento: "2026-10-01" }),
  nota({ id: "n4", numero_nf: "400", situacao: "cancelada", status: "cancelada", motivo_cancelamento: "duplicada" })
];

const CLIENTES = [
  { id: "c1", nome: "Prefeitura de Alfa", uf: "PR", status_contrato: "ativo" },
  { id: "c2", nome: "Prefeitura de Beta", uf: "SP", status_contrato: "suspenso" }
];

function linha(numero: string): HTMLElement {
  return screen.getByText(numero, { selector: "td" }).closest("tr")!;
}

describe("/notas — lista e filtros", () => {
  it("lista as notas com situação e só os botões que a máquina de estados permite em cada linha", async () => {
    instalarFetchFalso({ "GET /api/notas": { corpo: { notas: NOTAS, total: 4 } }, "GET /api/clientes": { corpo: { clientes: CLIENTES } } });
    render(<NotasPage />);

    await screen.findByText("100", { selector: "td" });
    const botoes = (numero: string) => within(linha(numero)).queryAllByRole("button").map((b) => b.textContent);

    expect(botoes("100")).toEqual(["Registrar atesto", "Cancelar nota", "Detalhes"]);
    expect(botoes("200")).toEqual(["Registrar pagamento", "Cancelar nota", "Detalhes"]);
    expect(botoes("300")).toEqual(["Reabrir pagamento", "Detalhes"]);
    expect(botoes("400")).toEqual(["Detalhes"]);
    expect(within(linha("100")).getByText("R$ 1.500,50", { exact: false })).toBeTruthy();
    expect(within(linha("300")).getByText("Paga")).toBeTruthy();
  });

  it("filtro de situação e busca por número vão pro servidor como query string", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/notas": { corpo: { notas: [], total: 0 } }, "GET /api/clientes": { corpo: { clientes: CLIENTES } } });
    const usuario = userEvent.setup();
    render(<NotasPage />);
    await screen.findByText(/Nenhuma nota encontrada/);

    await usuario.selectOptions(screen.getByLabelText("Situação"), "vencida");
    await waitFor(() => expect(chamadas.some((c) => c.url.includes("situacao=vencida"))).toBe(true));

    await usuario.type(screen.getByLabelText("Número da NF"), "NF-77");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(chamadas.some((c) => c.url.includes("busca=NF-77") && c.url.includes("situacao=vencida"))).toBe(true));
    expect(screen.getByText(/Nenhuma nota encontrada com estes filtros/)).toBeTruthy();
  });

  it("formulário de criação só oferece clientes com contrato ativo", async () => {
    instalarFetchFalso({ "GET /api/notas": { corpo: { notas: [], total: 0 } }, "GET /api/clientes": { corpo: { clientes: CLIENTES } } });
    const usuario = userEvent.setup();
    render(<NotasPage />);
    await usuario.click(await screen.findByRole("button", { name: "+ Nova nota" }));

    const form = screen.getByRole("form", { name: "Nova nota fiscal" });
    const opcoes = within(within(form).getByLabelText("Cliente (contrato ativo)")).getAllByRole("option").map((o) => o.textContent);
    expect(opcoes).toEqual(["Selecione…", "Prefeitura de Alfa — PR"]);
  });
});

describe("/notas — criação com erro de validação", () => {
  it("mostra o erro de cada campo devolvido pelo servidor (400) e o valor vai como TEXTO", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/notas": { corpo: { notas: [], total: 0 } },
      "GET /api/clientes": { corpo: { clientes: CLIENTES } },
      "POST /api/notas": { status: 400, corpo: { erro: "Dados inválidos", detalhes: { fieldErrors: { valor: "O valor precisa ser maior que zero." } } } }
    });
    const usuario = userEvent.setup();
    render(<NotasPage />);
    await usuario.click(await screen.findByRole("button", { name: "+ Nova nota" }));
    const form = screen.getByRole("form", { name: "Nova nota fiscal" });

    await usuario.selectOptions(within(form).getByLabelText("Cliente (contrato ativo)"), "c1");
    await usuario.type(within(form).getByLabelText("Competência (mês)"), "2026-10");
    await usuario.type(within(form).getByLabelText(/Valor/), "0,00");
    await usuario.click(within(form).getByRole("button", { name: "Criar nota" }));

    expect(await within(form).findByText("O valor precisa ser maior que zero.")).toBeTruthy();
    expect(within(form).getByRole("alert").textContent).toBe("Dados inválidos");
    const post = chamadas.find((c) => c.metodo === "POST");
    expect(post?.corpo).toMatchObject({ cliente_id: "c1", competencia: "2026-10", valor: "0,00" });
    expect(typeof (post?.corpo as { valor: unknown }).valor).toBe("string");
  });

  it("409 (cliente suspenso / número repetido) aparece como mensagem geral", async () => {
    instalarFetchFalso({
      "GET /api/notas": { corpo: { notas: [], total: 0 } },
      "GET /api/clientes": { corpo: { clientes: CLIENTES } },
      "POST /api/notas": { status: 409, corpo: { erro: "Já existe uma nota com este número para este cliente." } }
    });
    const usuario = userEvent.setup();
    render(<NotasPage />);
    await usuario.click(await screen.findByRole("button", { name: "+ Nova nota" }));
    const form = screen.getByRole("form", { name: "Nova nota fiscal" });
    await usuario.selectOptions(within(form).getByLabelText("Cliente (contrato ativo)"), "c1");
    await usuario.type(within(form).getByLabelText("Competência (mês)"), "2026-10");
    await usuario.type(within(form).getByLabelText(/Valor/), "10");
    await usuario.click(within(form).getByRole("button", { name: "Criar nota" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("Já existe uma nota com este número para este cliente.");
  });
});

describe("/notas — confirmação das ações", () => {
  it("registrar pagamento: nada é enviado antes de confirmar; confirmar manda acao+data", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/notas": { corpo: { notas: NOTAS, total: 4 } },
      "GET /api/clientes": { corpo: { clientes: CLIENTES } },
      "POST /api/notas/n2/acoes": { corpo: { ok: true, status_anterior: "atestada", status_novo: "paga" } }
    });
    const usuario = userEvent.setup();
    render(<NotasPage />);
    await screen.findByText("200", { selector: "td" });

    await usuario.click(within(linha("200")).getByRole("button", { name: "Registrar pagamento" }));
    const dialogo = screen.getByRole("dialog", { name: "Confirmar: Registrar pagamento" });
    expect(dialogo.textContent).toMatch(/Registrar o pagamento da NF 200/);
    expect(chamadas.filter((c) => c.metodo === "POST")).toHaveLength(0);

    await usuario.clear(within(dialogo).getByLabelText("Data do pagamento"));
    await usuario.type(within(dialogo).getByLabelText("Data do pagamento"), "2026-10-20");
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar: Registrar pagamento" }));

    await waitFor(() => expect(chamadas.find((c) => c.metodo === "POST")?.corpo).toEqual({ acao: "registrar_pagamento", data: "2026-10-20" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cancelar exige motivo: botão desabilitado até digitar; 409 do servidor aparece no painel", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/notas": { corpo: { notas: NOTAS, total: 4 } },
      "GET /api/clientes": { corpo: { clientes: CLIENTES } },
      "POST /api/notas/n1/acoes": { status: 409, corpo: { erro: "Esta nota já está cancelada." } }
    });
    const usuario = userEvent.setup();
    render(<NotasPage />);
    await screen.findByText("100", { selector: "td" });

    await usuario.click(within(linha("100")).getByRole("button", { name: "Cancelar nota" }));
    const dialogo = screen.getByRole("dialog", { name: "Confirmar: Cancelar nota" });
    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar: Cancelar nota" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);

    await usuario.type(within(dialogo).getByLabelText(/Motivo \(obrigatório\)/), "NF com CNPJ errado");
    expect(confirmar.disabled).toBe(false);
    await usuario.click(confirmar);

    expect(await within(dialogo).findByText("Esta nota já está cancelada.")).toBeTruthy();
    expect(chamadas.find((c) => c.metodo === "POST")?.corpo).toEqual({ acao: "cancelar", motivo: "NF com CNPJ errado" });
  });

  it("detalhes mostram o histórico de eventos com autor e motivo", async () => {
    instalarFetchFalso({
      "GET /api/notas/n4/eventos": {
        corpo: {
          eventos: [
            { id: "e1", tipo: "criacao", status_anterior: null, status_novo: "aguardando_atesto", data_evento: null, motivo: null, observacao: null, feito_por_nome: "Ana", feito_em: "2026-10-05T12:00:00.000Z" },
            { id: "e2", tipo: "cancelamento", status_anterior: "aguardando_atesto", status_novo: "cancelada", data_evento: null, motivo: "duplicada", observacao: null, feito_por_nome: "Bruno", feito_em: "2026-10-06T12:00:00.000Z" }
          ]
        }
      },
      "GET /api/notas": { corpo: { notas: NOTAS, total: 4 } },
      "GET /api/clientes": { corpo: { clientes: CLIENTES } }
    });
    const usuario = userEvent.setup();
    render(<NotasPage />);
    await screen.findByText("400", { selector: "td" });

    await usuario.click(within(linha("400")).getByRole("button", { name: "Detalhes" }));
    expect(await screen.findByText("Nota cancelada")).toBeTruthy();
    expect(screen.getByText("Nota criada")).toBeTruthy();
    expect(screen.getByText(/por\s+Bruno/)).toBeTruthy();
    expect(screen.getAllByText("Motivo: duplicada").length).toBeGreaterThan(0);
  });
});
