// Tela de Clientes — mapa público (rodada 15-B): etiqueta na listagem,
// seção "Divulgação pública" (buscar posição, aviso de divergência com o
// nome oficial do IBGE, posição pendente, autorizar/revogar só com
// confirmação, quem autorizou e quando). Fetch falso.

import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";
import ClientesPage from "./page";
import { TEXTO_AUTORIZACAO } from "./DivulgacaoPublica";

const BASE = {
  uf: "PR", plano: "dispensa", valor_mensal: "1000.00", sistema_portal: null, contrato_arquivo_nome: null, contrato_versao_atual: null, taxa_implantacao: null,
  data_inicio_contrato: "2026-01-01", cancelamento_pedido_em: null, cancelamento_termino_em: null, cancelamento_motivo: null, status_contrato: "ativo",
  dia_vencimento_contrato: 1, portal_url: null, contato_email: null, observacao: null,
  codigo_ibge: null, latitude: null, longitude: null, autorizacao_divulgacao: false, autorizacao_divulgacao_em: null, autorizacao_divulgacao_por_nome: null
};
const SEM_CODIGO = { ...BASE, id: "c1", nome: "Prefeitura Municipal de Curitiba" };
const NO_MAPA = { ...BASE, id: "c2", nome: "Prefeitura de Londrina", codigo_ibge: "4113700", latitude: "-23.300000", longitude: "-51.160000", autorizacao_divulgacao: true, autorizacao_divulgacao_em: "2026-11-10T13:30:00.000Z", autorizacao_divulgacao_por_nome: "Luana" };
const PENDENTE = { ...BASE, id: "c3", nome: "Prefeitura de Maringá", codigo_ibge: "4115200" };
const SEM_AUTORIZACAO = { ...BASE, id: "c4", nome: "Prefeitura de Cascavel", codigo_ibge: "4104808", latitude: "-24.950000", longitude: "-53.450000" };
const ENCERRADO = { ...NO_MAPA, id: "c5", nome: "Prefeitura de Toledo", codigo_ibge: "4127700", status_contrato: "encerrado" };

async function abrirEdicao(usuario: ReturnType<typeof userEvent.setup>, nome: string) {
  const linha = (await screen.findByText(`${nome} — PR`)).closest("tr")!;
  await usuario.click(within(linha).getByRole("button", { name: "Editar" }));
  return screen.getByRole("region", { name: "Divulgação pública" });
}

describe("Clientes — etiqueta do mapa público", () => {
  it("No mapa / Sem autorização / Sem código IBGE / Posição pendente / fora do mapa (contrato não vigente)", async () => {
    instalarFetchFalso({ "GET /api/clientes": { corpo: { clientes: [SEM_CODIGO, NO_MAPA, PENDENTE, SEM_AUTORIZACAO, ENCERRADO] } } });
    render(<ClientesPage />);
    const etiqueta = async (nome: string) => within((await screen.findByText(`${nome} — PR`)).closest("tr")!).getByTestId("etiqueta-mapa").textContent;
    expect(await etiqueta("Prefeitura Municipal de Curitiba")).toBe("Sem código IBGE");
    expect(await etiqueta("Prefeitura de Londrina")).toBe("No mapa");
    expect(await etiqueta("Prefeitura de Maringá")).toBe("Posição pendente");
    expect(await etiqueta("Prefeitura de Cascavel")).toBe("Sem autorização");
    expect(await etiqueta("Prefeitura de Toledo")).toBe("Autorizado, fora do mapa (contrato não vigente)");
  });
});

describe("Clientes — seção Divulgação pública", () => {
  it("Buscar posição: mostra nome/UF oficial e posição; avisa divergência sem bloquear; texto da autorização por escrito", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/clientes": { corpo: { clientes: [SEM_CODIGO] } },
      "PUT /api/clientes/c1/divulgacao": { corpo: { codigoIbge: "4113700", posicao: { lat: -23.3, lon: -51.16 }, ibge: { status: "ok", nome: "Londrina", uf: "PR" }, confere: false } }
    });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    const secao = await abrirEdicao(usuario, "Prefeitura Municipal de Curitiba");
    expect(secao.textContent).toContain(TEXTO_AUTORIZACAO);
    expect((within(secao).getByRole("switch") as HTMLInputElement).disabled).toBe(true); // sem posição não autoriza

    await usuario.type(within(secao).getByLabelText(/Código IBGE/), "41137x00"); // só dígitos, até 7
    expect((within(secao).getByLabelText(/Código IBGE/) as HTMLInputElement).value).toBe("4113700");
    await usuario.click(within(secao).getByRole("button", { name: "Buscar posição" }));

    await waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT")?.corpo).toEqual({ acao: "definir_codigo", codigoIbge: "4113700" }));
    expect((await within(secao).findByText(/IBGE:/)).textContent).toMatch(/Londrina — PR · posição -23\.3000, -51\.1600/);
    expect(within(secao).getByRole("alert").textContent).toMatch(/não parece ser de Prefeitura Municipal de Curitiba — PR \(o IBGE diz Londrina — PR\)/);
  });

  it("IBGE indisponível: avisa 'posição pendente'", async () => {
    instalarFetchFalso({
      "GET /api/clientes": { corpo: { clientes: [SEM_CODIGO] } },
      "PUT /api/clientes/c1/divulgacao": { corpo: { codigoIbge: "4106902", posicao: null, ibge: { status: "indisponivel", ufDoCodigo: "PR" }, confere: null } }
    });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    const secao = await abrirEdicao(usuario, "Prefeitura Municipal de Curitiba");
    await usuario.type(within(secao).getByLabelText(/Código IBGE/), "4106902");
    await usuario.click(within(secao).getByRole("button", { name: "Buscar posição" }));
    expect((await within(secao).findByRole("status")).textContent).toMatch(/IBGE indisponível agora — o código foi salvo com a posição pendente/);
  });

  it("autorizar: confirmação explícita antes do PUT", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/clientes": { corpo: { clientes: [SEM_AUTORIZACAO] } }, "PUT /api/clientes/c4/divulgacao": { corpo: { autorizado: true } } });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    const secao = await abrirEdicao(usuario, "Prefeitura de Cascavel");
    await usuario.click(within(secao).getByRole("switch"));
    const dialogo = within(secao).getByRole("dialog", { name: "Confirmar autorização" });
    expect(dialogo.textContent).toMatch(/Confirme que existe autorização por escrito da prefeitura/);
    expect(chamadas.some((c) => c.metodo === "PUT")).toBe(false);
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar autorização" }));
    await waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT")?.corpo).toEqual({ acao: "autorizar" }));
  });

  it("autorizado: mostra quem e quando; código travado; revogar confirma e avisa 'até 1 minuto'; 409 aparece", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/clientes": { corpo: { clientes: [NO_MAPA] } }, "PUT /api/clientes/c2/divulgacao": { status: 409, corpo: { erro: "Este cliente não está autorizado no mapa público." } } });
    const usuario = userEvent.setup();
    render(<ClientesPage />);
    const secao = await abrirEdicao(usuario, "Prefeitura de Londrina");
    expect(secao.textContent).toMatch(/Autorizado por Luana em 10\/11\/2026, 10:30\./);
    expect((within(secao).getByLabelText(/Código IBGE/) as HTMLInputElement).disabled).toBe(true);
    await usuario.click(within(secao).getByRole("switch"));
    const dialogo = within(secao).getByRole("dialog", { name: "Confirmar revogação" });
    expect(dialogo.textContent).toMatch(/sai do mapa público em até 1 minuto/);
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar revogação" }));
    await waitFor(() => expect(chamadas.find((c) => c.metodo === "PUT")?.corpo).toEqual({ acao: "revogar" }));
    expect((await within(secao).findByRole("alert")).textContent).toBe("Este cliente não está autorizado no mapa público.");
  });
});
