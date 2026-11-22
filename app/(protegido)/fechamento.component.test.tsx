// Telas do FECHAMENTO (rodada 16-B1): formulário de aceite (3 blocos,
// validação, prévia "Confira antes de confirmar"), tela de modelos
// (rascunho/aprovado, campos, aprovação com confirmação), tela de tarefas
// (abas, selos, ações, registro da assinatura) e o selo "Aguardando
// assinatura". Fetch falso; router mockado; timeout explícito (digitação).

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";
import { CAMPOS_MODELO } from "@/lib/contratoModelo";
import type { ModeloContrato } from "@/lib/modelosContratoServico";
import type { TarefaListada } from "@/lib/tarefasServico";

const { pushMock, refreshMock } = vi.hoisted(() => ({ pushMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }), usePathname: () => "/" }));

import FormAceite, { type DadosIniciaisAceite } from "./crm/[id]/aceite/FormAceite";
import TelaModelos from "./modelos-contrato/TelaModelos";
import TelaTarefas from "./operacao/TelaTarefas";
import SeloStatusContrato from "@/components/SeloStatusContrato";

const TEMPO = 30_000;
const INICIAL: DadosIniciaisAceite = {
  leadId: "l1",
  versao: 4,
  municipio: { nome: "Maringá", uf: "PR", codigo_ibge: "4115200", populacao: 432635 },
  plano: "grande_porte",
  origemPlano: "populacao",
  contato: { nome: "Ana", cargo: "Secretária", email: "ana@prefeitura.invalid", telefone: "(44) 3221-0000" }
};

async function preencherDadosDaPrefeitura(usuario: ReturnType<typeof userEvent.setup>, cnpj = "11.222.333/0001-81") {
  await usuario.type(screen.getByLabelText("CNPJ da prefeitura"), cnpj);
  await usuario.type(screen.getByLabelText("CEP"), "87013-230");
  await usuario.type(screen.getByLabelText("Logradouro"), "Av. XV de Novembro");
  await usuario.type(screen.getByLabelText("Número"), "701");
  await usuario.type(screen.getByLabelText("Bairro"), "Centro");
  await usuario.type(screen.getByLabelText("Representante legal — nome"), "Prefeito de Teste");
  await usuario.type(screen.getByLabelText("Representante legal — cargo"), "Prefeito Municipal");
}

describe("formulário de aceite", () => {
  it("3 blocos; município da base; plano sugerido com valores padrão; contato do lead pré-preenchido; trocar plano repõe valores; Dispensa sem taxa", async () => {
    instalarFetchFalso({});
    const usuario = userEvent.setup();
    render(<FormAceite inicial={INICIAL} />);
    for (const bloco of ["1. Município", "2. Contrato", "3. Dados da prefeitura"]) expect(screen.getByRole("region", { name: bloco })).toBeTruthy();
    expect(screen.getByTestId("municipio-do-aceite").textContent).toBe("Maringá — PR · código IBGE 4115200 · 432.635 hab.");
    expect((screen.getByLabelText("Mensalidade (R$)") as HTMLInputElement).value).toBe("35000,00");
    expect((screen.getByLabelText("Taxa de implantação (R$)") as HTMLInputElement).value).toBe("30000,00");
    expect((screen.getByLabelText("Contato operacional — e-mail") as HTMLInputElement).value).toBe("ana@prefeitura.invalid");
    await usuario.selectOptions(screen.getByLabelText("Plano"), "dispensa");
    expect((screen.getByLabelText("Mensalidade (R$)") as HTMLInputElement).value).toBe("5457,00");
    expect(screen.queryByLabelText("Taxa de implantação (R$)")).toBeNull();
    expect(screen.getByText("Dispensa não tem taxa de implantação.")).toBeTruthy();
  }, TEMPO);

  it("validação antes da prévia: obrigatórios e CNPJ com dígito errado; nada é enviado", async () => {
    const chamadas = instalarFetchFalso({});
    const usuario = userEvent.setup();
    render(<FormAceite inicial={INICIAL} />);
    await usuario.type(screen.getByLabelText("CNPJ da prefeitura"), "11.222.333/0001-82");
    await usuario.click(screen.getByRole("button", { name: "Conferir antes de confirmar" }));
    expect(screen.getByRole("alert").textContent).toBe("Confira os campos destacados.");
    expect(screen.getByText("CNPJ inválido — confira os 14 dígitos.")).toBeTruthy();
    expect(screen.getAllByText("Obrigatório.").length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chamadas).toHaveLength(0);
  }, TEMPO);

  it("prévia 'Confira antes de confirmar' com os dados e o que vai acontecer; confirmar envia TUDO e vai pro lead", async () => {
    const chamadas = instalarFetchFalso({ "POST /api/leads/l1/aceite": { status: 201, corpo: { cliente_id: "c1", tarefa_id: "t1", reaproveitou_ex_cliente: false } } });
    const usuario = userEvent.setup();
    render(<FormAceite inicial={INICIAL} />);
    await preencherDadosDaPrefeitura(usuario);
    await usuario.click(screen.getByRole("button", { name: "Conferir antes de confirmar" }));
    const previa = screen.getByRole("dialog", { name: "Confira antes de confirmar" });
    expect(previa.textContent).toContain("Prefeitura Municipal de Maringá — PR (IBGE 4115200)");
    expect(previa.textContent).toContain("11.222.333/0001-81");
    expect(previa.textContent).toContain("CEP 87013-230");
    expect(within(previa).getByRole("list", { name: "O que vai acontecer" }).textContent).toMatch(/AGUARDANDO ASSINATURA.*Grande Porte.*pessoa de Contratos/);
    await usuario.click(within(previa).getByRole("button", { name: "Confirmar o aceite" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/l1?aceite=ok"));
    expect(chamadas[0].corpo).toMatchObject({ versao: 4, plano: "grande_porte", valor_mensal: "35000,00", taxa_implantacao: "30000,00", cnpj: "11.222.333/0001-81", data_prevista_assinatura: null, contato_nome: "Ana" });
  }, TEMPO);

  it("erro do servidor volta pro formulário com a mensagem (ex.: cliente já existe)", async () => {
    instalarFetchFalso({ "POST /api/leads/l1/aceite": { status: 409, corpo: { erro: "Esta prefeitura já é cliente da NEXAIGEN (contrato ativo) — o aceite não cria outro cliente." } } });
    const usuario = userEvent.setup();
    render(<FormAceite inicial={INICIAL} />);
    await preencherDadosDaPrefeitura(usuario);
    await usuario.click(screen.getByRole("button", { name: "Conferir antes de confirmar" }));
    await usuario.click(screen.getByRole("button", { name: "Confirmar o aceite" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/já é cliente da NEXAIGEN/);
    expect(screen.getByRole("form", { name: "Registrar aceite da prefeitura" })).toBeTruthy();
  }, TEMPO);

  it("lead sem município da base: só o aviso de vincular, sem formulário", () => {
    instalarFetchFalso({});
    render(<FormAceite inicial={{ ...INICIAL, municipio: { ...INICIAL.municipio, codigo_ibge: null } }} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Vincule o município no detalhe do lead/);
    expect(screen.queryByRole("form")).toBeNull();
  });
});

const modelo = (extra: Partial<ModeloContrato>): ModeloContrato => ({
  id: "m1", plano: "pequeno_porte", versao: 1, titulo: "Contrato provisório", conteudo: "# Contrato\n\n{{municipio_nome}}", status: "rascunho",
  criado_em: "2026-11-01T12:00:00.000Z", criado_por_nome: null, aprovado_em: null, aprovado_por_nome: null, ...extra
});

describe("tela de modelos de contrato", () => {
  it("situação por plano (rascunho/aprovado), lista de campos, aprovar com confirmação", async () => {
    const chamadas = instalarFetchFalso({ "POST /api/modelos-contrato/m1/aprovar": { corpo: { plano: "pequeno_porte", versao: 1 } } });
    const usuario = userEvent.setup();
    render(<TelaModelos modelos={[modelo({}), modelo({ id: "m2", plano: "medio_porte", status: "aprovado", aprovado_em: "2026-11-10T12:00:00.000Z", aprovado_por_nome: "Ana Admin" })]} campos={[...CAMPOS_MODELO]} />);
    expect(screen.getByTestId("situacao-pequeno_porte").textContent).toBe("Sem versão aprovada — contratos saem como RASCUNHO");
    expect(screen.getByTestId("situacao-medio_porte").textContent).toBe("Em uso: v1 (aprovada)");
    const campos = screen.getByRole("complementary", { name: "Campos disponíveis" });
    for (const c of CAMPOS_MODELO) expect(campos.textContent).toContain(`{{${c.campo}}}`);
    await usuario.click(within(screen.getByRole("region", { name: "Plano Pequeno Porte" })).getByRole("button", { name: "Aprovar" }));
    expect(chamadas).toHaveLength(0); // ainda pede confirmação
    await usuario.click(within(screen.getByRole("dialog", { name: "Confirmar aprovação" })).getByRole("button", { name: "Confirmar aprovação" }));
    await waitFor(() => expect(chamadas.map((c) => c.url)).toEqual(["/api/modelos-contrato/m1/aprovar"]));
    expect(refreshMock).toHaveBeenCalled();
  }, TEMPO);

  it("editar = nova versão: pré-visualização com dados de exemplo e erro de campo desconhecido ao salvar", async () => {
    const chamadas = instalarFetchFalso({
      "POST /api/modelos-contrato/previa": { corpo: { ok: true, texto: "Contrato\n\nExemplópolis", faixa: "RASCUNHO — SEM VALIDADE JURÍDICA — modelo v0 do plano Pequeno Porte", rodape: "Gerado em …" } },
      "POST /api/modelos-contrato": { status: 400, corpo: { erro: "Dados inválidos", detalhes: { fieldErrors: { conteudo: ["Campo(s) desconhecido(s): {{cpf}}. Use só os da lista de campos disponíveis."] } } } }
    });
    const usuario = userEvent.setup();
    render(<TelaModelos modelos={[modelo({})]} campos={[...CAMPOS_MODELO]} />);
    await usuario.click(within(screen.getByRole("region", { name: "Plano Pequeno Porte" })).getByRole("button", { name: "Editar (nova versão)" }));
    const editor = screen.getByRole("region", { name: "Nova versão — Pequeno Porte" });
    expect(editor.textContent).toContain("Salvar cria a versão 2 em RASCUNHO. A versão 1 continua como está.");
    expect((within(editor).getByLabelText("Texto do modelo") as HTMLTextAreaElement).value).toBe("# Contrato\n\n{{municipio_nome}}");
    await usuario.click(within(editor).getByRole("button", { name: "Pré-visualizar com dados de exemplo" }));
    expect((await screen.findByTestId("texto-previa")).textContent).toBe("Contrato\n\nExemplópolis");
    await usuario.click(within(editor).getByRole("button", { name: "Salvar como nova versão (rascunho)" }));
    expect((await within(editor).findByRole("alert")).textContent).toMatch(/\{\{cpf\}\}/);
    expect(chamadas.find((c) => c.url === "/api/modelos-contrato")!.corpo).toMatchObject({ plano: "pequeno_porte", conteudo: "# Contrato\n\n{{municipio_nome}}" });
  }, TEMPO);
});

const tarefa = (extra: Partial<TarefaListada>): TarefaListada => ({
  id: "t1", tipo: "contrato_assinatura", status: "aberta", prazo: "2026-11-20", selo: "atrasada", criado_em: "2026-11-15T12:00:00.000Z",
  responsavel_nome: null, minha: false, observacao: null,
  cliente: {
    id: "c1", nome: "Prefeitura Municipal de Maringá", status_contrato: "aguardando_assinatura", plano: "grande_porte", valor_mensal_centavos: 3500000, taxa_implantacao_centavos: 3000000,
    cnpj: "11222333000181", endereco_logradouro: "Av. XV", endereco_numero: "701", endereco_complemento: null, endereco_bairro: "Centro", endereco_cep: "87013230",
    representante_nome: "Prefeito", representante_cargo: "Prefeito Municipal", contato_nome: "Ana", contato_cargo: "Secretária", contato_email: "ana@x.invalid", contato_telefone: "(44) 1"
  },
  historico: [{ acao: "criada", autor_nome: "Vera Vendas", em: "2026-11-15T12:00:00.000Z", detalhe: "Aberta pelo aceite registrado no CRM." }],
  ...extra
});

describe("tela de tarefas", () => {
  it("abas (admin vê Todas e Em atraso; Contratos não), contagem, selos, dados do cliente, baixar contrato e assumir", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/operacao/tarefas": { corpo: { tarefas: [tarefa({}), tarefa({ id: "t2", selo: "vence_hoje", status: "em_andamento", responsavel_nome: "Carla", minha: true })], contagem: { abertas: 2, atrasadas: 1, minhas: 1 } } },
      "POST /api/operacao/tarefas/t1": { corpo: { status: "em_andamento" } }
    });
    const usuario = userEvent.setup();
    const { unmount } = render(<TelaTarefas admin={false} papel="contratos" />);
    expect((await screen.findByTestId("contagem-tarefas")).textContent).toBe("2 tarefas abertas · 1 atrasada · 1 com você");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Minhas tarefas", "Fila do meu papel"]);
    const t1 = screen.getByTestId("tarefa-t1");
    expect(within(t1).getByTestId("selo-atrasada").textContent).toBe("atrasada");
    expect(within(screen.getByTestId("tarefa-t2")).getByTestId("selo-vence-hoje")).toBeTruthy();
    expect(within(t1).getByTestId("dados-cliente").textContent).toMatch(/Mensalidade: R\$\s*35\.000,00.*CNPJ: 11\.222\.333\/0001-81/);
    expect(within(t1).getByRole("link", { name: "Baixar contrato gerado (.docx)" }).getAttribute("href")).toBe("/api/clientes/c1/contrato/gerar");
    expect(within(t1).getByRole("form", { name: "Registrar assinatura" })).toBeTruthy();
    expect(within(t1).queryByRole("button", { name: "Alterar prazo" })).toBeNull(); // só admin
    await usuario.click(within(t1).getByRole("button", { name: "Assumir" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST")).toBe(true));
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ acao: "assumir" });
    unmount();
    render(<TelaTarefas admin papel="admin" />);
    expect((await screen.findAllByRole("tab")).map((t) => t.textContent)).toEqual(["Minhas tarefas", "Fila (não assumidas)", "Todas", "Em atraso"]);
    expect(within(await screen.findByTestId("tarefa-t1")).getByRole("button", { name: "Alterar prazo" })).toBeTruthy();
  }, TEMPO);

  it("registrar assinatura: manda data e PDF em multipart; implantação: concluir com observação", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/operacao/tarefas": { corpo: { tarefas: [tarefa({})], contagem: { abertas: 1, atrasadas: 1, minhas: 0 } } },
      "POST /api/operacao/clientes/c1/assinatura": { corpo: { versao_contrato: 1, tarefa_implantacao_id: "t9" } }
    });
    const usuario = userEvent.setup();
    const { unmount } = render(<TelaTarefas admin={false} papel="contratos" />);
    const form = await screen.findByRole("form", { name: "Registrar assinatura" });
    await usuario.type(within(form).getByLabelText("Data da assinatura"), "2026-11-20");
    await usuario.upload(within(form).getByLabelText("PDF assinado"), new File(["%PDF-1.4"], "assinado.pdf", { type: "application/pdf" }));
    await usuario.click(within(form).getByRole("button", { name: "Registrar assinatura" }));
    await waitFor(() => expect(chamadas.some((c) => c.url === "/api/operacao/clientes/c1/assinatura")).toBe(true));
    const corpo = chamadas.find((c) => c.url === "/api/operacao/clientes/c1/assinatura")!.corpo as FormData;
    expect(corpo.get("data_assinatura")).toBe("2026-11-20");
    expect((corpo.get("arquivo") as File).name).toBe("assinado.pdf");
    unmount();

    const impl = tarefa({
      id: "t5", tipo: "implantacao", status: "em_andamento", minha: true, selo: null,
      cliente: { id: "c1", nome: "Prefeitura Municipal de Maringá", plano: "grande_porte", uf: "PR", codigo_ibge: "4115200", contato_nome: "Ana", contato_cargo: "Secretária", contato_email: "ana@x.invalid", contato_telefone: "(44) 1" }
    });
    const chamadas2 = instalarFetchFalso({ "GET /api/operacao/tarefas": { corpo: { tarefas: [impl], contagem: { abertas: 1, atrasadas: 0, minhas: 1 } } }, "POST /api/operacao/tarefas/t5": { corpo: { status: "concluida" } } });
    render(<TelaTarefas admin={false} papel="implantacao" />);
    const cartao = await screen.findByTestId("tarefa-t5");
    expect(within(cartao).getByTestId("dados-cliente").textContent).not.toMatch(/Mensalidade|CNPJ/);
    expect(within(cartao).queryByRole("form", { name: "Registrar assinatura" })).toBeNull();
    await usuario.type(within(cartao).getByLabelText("Observação da conclusão"), "Provisionado e treinado.");
    await usuario.click(within(cartao).getByRole("button", { name: "Concluir implantação" }));
    await waitFor(() => expect(chamadas2.some((c) => c.metodo === "POST")).toBe(true));
    expect(chamadas2.find((c) => c.metodo === "POST")!.corpo).toEqual({ acao: "concluir", observacao: "Provisionado e treinado." });
  }, TEMPO);
});

describe("selo do contrato", () => {
  it('"Aguardando assinatura" com texto (não só cor)', () => {
    render(<SeloStatusContrato status="aguardando_assinatura" />);
    expect(screen.getByTestId("selo-status-contrato").textContent).toBe("Aguardando assinatura");
  });
});
