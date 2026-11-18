// Telas da base territorial (rodada 16-A2): tela da ENTIDADE ("X de Y",
// faixa "já fecharam conosco", lista dos membros, estado vazio, prévia do
// lote), TERRITÓRIO (filtros na URL, legenda, seleção, lead de colega só com
// vendedor e etapa), filtro de PLANO na lista de leads e VISÃO SALVA.
// Linhas montadas pela função real (lib/territorio.ts#montarLinha); fetch
// falso; router mockado. Timeout explícito: digitação/cliques simulados.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";
import { FILTROS_VAZIOS, PARAMETROS_POR_TELA, montarLinha, resumirLinhas, type ClienteDoTerritorio, type LeadDoTerritorio, type MunicipioDoTerritorio } from "@/lib/territorio";
import type { EntidadeDetalhe } from "@/lib/territorioRepositorio";

const { pushMock, refreshMock } = vi.hoisted(() => ({ pushMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }), usePathname: () => "/crm/territorio" }));

import TelaEntidade from "../entidades/[id]/TelaEntidade";
import TabelaTerritorio from "./TabelaTerritorio";
import VisoesSalvas from "../VisoesSalvas";
import ListaLeads from "../ListaLeads";

const TEMPO = 20_000;
const HOJE = "2026-11-18";
const vendas = { equipeId: "beto", admin: false };
const mun = (codigo: string, nome: string, populacao: number | null): MunicipioDoTerritorio => ({ codigo_ibge: codigo, nome, uf: "PR", populacao, populacao_ano: 2026, microrregiao: "Toledo", mesorregiao: "Oeste" });
const cliente = (codigo: string, plano: string): ClienteDoTerritorio => ({ nome: "x", uf: "PR", codigo_ibge: codigo, status_contrato: "ativo", cancelamento_termino_em: null, encerrado_em: null, plano, data_inicio_contrato: "2026-02-01" });
const leadDe = (codigo: string, vendedorId: string, vendedorNome: string): LeadDoTerritorio => ({
  id: `lead-${codigo}`, municipio_nome: "x", nome_busca: "x", uf: "PR", codigo_ibge: codigo, etapa: "proposta", vendedor_id: vendedorId, vendedor_nome: vendedorNome,
  plano_interesse: "grande_porte", motivo_perda: null, proxima_acao_em: null, atualizado_em: "2026-11-10T12:00:00.000Z", ultima_atividade_em: "2026-11-10T12:00:00.000Z"
});
const ETIQUETA = [{ id: "e1", nome: "Associação dos Municípios do Oeste", sigla: "AMOP", clientes: 1 }];

const LINHAS = [
  montarLinha(mun("4127700", "Toledo", 162_658), [cliente("4127700", "pequeno_porte")], [], ETIQUETA, vendas, HOJE),
  montarLinha(mun("4104808", "Cascavel", 372_026), [], [leadDe("4104808", "vera", "Vera Vendas")], ETIQUETA, vendas, HOJE),
  montarLinha(mun("4100103", "Abatiá", 7_201), [], [], ETIQUETA, vendas, HOJE),
  montarLinha(mun("4199990", "Sem População", null), [], [], ETIQUETA, vendas, HOJE)
];

const ENTIDADE: EntidadeDetalhe = {
  id: "e1", nome: "Associação dos Municípios do Oeste", sigla: "AMOP", tipo: "associacao_municipios", uf: "PR", site: "https://amop.invalid", contato_nome: "Secretaria", contato_email: null,
  contato_telefone: null, observacao: null, fonte_url: "https://amop.invalid/municipios", verificado_em: "2025-01-10", ativo: true, atualizado_em: "2026-11-01T00:00:00.000Z"
};

const tabela = (extra: object = {}) => ({
  filtros: { ...FILTROS_VAZIOS, uf: "PR" },
  avisos: [],
  linhas: LINHAS,
  total: LINHAS.length,
  resumo: resumirLinhas(LINHAS),
  admin: false,
  vendedores: [],
  microrregioes: ["Toledo"],
  entidades: [{ id: "e1", nome: ENTIDADE.nome, sigla: "AMOP" }],
  parametrosVisao: PARAMETROS_POR_TELA.territorio,
  ...extra
});

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
});

describe("tela da ENTIDADE", () => {
  it("cabeçalho grande 'X de Y', faixa 'já fecharam conosco' (nome, plano, desde), fonte com aviso de verificação antiga e a lista dos membros", () => {
    instalarFetchFalso({ "GET /api/crm/visoes": { corpo: { visoes: [] } } });
    render(<TelaEntidade entidade={ENTIDADE} todosMembros={LINHAS} hoje={HOJE} tabela={tabela()} />);
    expect(screen.getByTestId("x-de-y").textContent).toBe("1 de 4 prefeituras já são clientes da NEXAIGEN");
    const faixa = screen.getByRole("list", { name: "Já fecharam conosco" });
    expect(within(faixa).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Toledo · Pequeno Porte · desde 01/02/2026"]);
    expect(screen.getByRole("heading", { name: /Já fecharam conosco/i })).toBeTruthy();
    expect(screen.getByTestId("aviso-verificacao").textContent).toMatch(/mais de 12 meses/);
    expect(screen.getByText("https://amop.invalid/municipios").closest("a")!.getAttribute("href")).toBe("https://amop.invalid/municipios");
    expect(screen.getByTestId("linha-4104808")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abrir leads de todas as prefeituras ainda não abordadas desta entidade (2)" })).toBeTruthy();
  }, TEMPO);

  it("nenhum cliente: 'Nenhuma prefeitura desta entidade fechou ainda' e sem faixa; sem membros: estado vazio amigável", () => {
    instalarFetchFalso({ "GET /api/crm/visoes": { corpo: { visoes: [] } } });
    const semCliente = LINHAS.slice(1);
    const { unmount } = render(<TelaEntidade entidade={ENTIDADE} todosMembros={semCliente} hoje={HOJE} tabela={tabela({ linhas: semCliente })} />);
    expect(screen.getByTestId("x-de-y").textContent).toBe("Nenhuma prefeitura desta entidade fechou ainda");
    expect(screen.queryByRole("list", { name: "Já fecharam conosco" })).toBeNull();
    unmount();
    render(<TelaEntidade entidade={ENTIDADE} todosMembros={[]} hoje={HOJE} tabela={tabela({ linhas: [], total: 0 })} />);
    expect(screen.getByText("Nenhuma prefeitura cadastrada nesta entidade ainda.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  }, TEMPO);

  it("ação de destaque: PRÉVIA (quantas serão criadas, quais puladas e por quê) e só depois confirma", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/crm/visoes": { corpo: { visoes: [] } },
      "POST /api/territorio/leads": (_url, init) =>
        JSON.parse(String(init!.body)).acao === "previa"
          ? { corpo: { criar: [{ codigo_ibge: "4100103", nome: "Abatiá", uf: "PR" }, { codigo_ibge: "4199990", nome: "Sem População", uf: "PR" }], pulados: [{ codigo_ibge: "4127700", nome: "Toledo", uf: "PR", motivo: "já é cliente (contrato ativo)" }] } }
          : { status: 201, corpo: { criados: [{ codigo_ibge: "4100103", nome: "Abatiá", uf: "PR", lead_id: "n1" }, { codigo_ibge: "4199990", nome: "Sem População", uf: "PR", lead_id: "n2" }], pulados: [] } }
    });
    const usuario = userEvent.setup();
    render(<TelaEntidade entidade={ENTIDADE} todosMembros={LINHAS} hoje={HOJE} tabela={tabela()} />);
    await usuario.click(screen.getByRole("button", { name: /Abrir leads de todas as prefeituras ainda não abordadas/ }));
    const dialogo = await screen.findByRole("dialog", { name: "Prévia da criação de leads" });
    expect(within(dialogo).getByTestId("previa-resumo").textContent).toBe("2 leads serão criados · 1 prefeitura será pulada");
    expect(within(dialogo).getByRole("list", { name: "Puladas" }).textContent).toBe("Toledo — PR: já é cliente (contrato ativo)");
    expect(chamadas.filter((c) => c.metodo === "POST").map((c) => c.corpo)).toEqual([{ acao: "previa", alvo: { modo: "nao_abordados", filtros: {}, entidade_id: "e1" } }]);
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar e criar 2 leads" }));
    expect((await screen.findByRole("status", { name: "Resultado da criação de leads" })).textContent).toMatch(/^2 leads criados/);
    expect(chamadas.filter((c) => c.metodo === "POST").at(-1)!.corpo).toEqual({ acao: "criar", alvo: { modo: "nao_abordados", filtros: {}, entidade_id: "e1" } });
    expect(refreshMock).toHaveBeenCalled();
  }, TEMPO);
});

describe("TERRITÓRIO", () => {
  it("legenda sempre visível; status e plano com TEXTO e origem; lead de colega só com vendedor e etapa; contagem", () => {
    instalarFetchFalso({ "GET /api/crm/visoes": { corpo: { visoes: [] } } });
    render(<TabelaTerritorio tela="territorio" base="/crm/territorio" ufs={["PR"]} {...tabela()} />);
    const legenda = screen.getByRole("region", { name: "Legenda" });
    for (const t of ["Cliente", "Em negociação", "Perdido", "Ex-cliente", "Não abordado", "sugerido pela população"]) expect(legenda.textContent).toContain(t);
    expect(screen.getByTestId("contagem").textContent).toBe("4 prefeituras");
    const toledo = screen.getByTestId("linha-4127700");
    expect(within(toledo).getByTestId("selo-status").textContent).toBe("Cliente — ativo");
    expect(within(toledo).getByTestId("origem-plano").textContent).toBe("contratado");
    expect(within(toledo).getByTestId("aviso-plano-diferente").textContent).toMatch(/plano diferente do sugerido pela população/);
    expect(within(toledo).getByTestId("etiqueta-entidade").textContent).toBe("AMOP · 1 prefeitura desta entidade já é cliente");
    const cascavel = screen.getByTestId("linha-4104808");
    expect(within(cascavel).getByTestId("lead-de-colega").textContent).toBe("Com Vera Vendas — etapa Proposta");
    expect(within(cascavel).queryByRole("button", { name: "Abrir lead" })).toBeNull();
    expect(within(cascavel).getByTestId("origem-plano").textContent).toBe("sugerido pela população"); // não "de interesse" (é do colega)
    expect(within(screen.getByTestId("linha-4100103")).getByRole("button", { name: "Abrir lead" })).toBeTruthy();
    expect(within(screen.getByTestId("linha-4199990")).getByText("Sem plano definido")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Resumo" }).textContent).toContain("Cobertura (clientes ÷ total)25%");
    expect(screen.queryByText("Exportar CSV")).toBeNull(); // vendas não exporta
  }, TEMPO);

  it("filtros vão na URL (plano múltiplo, ignorar sugerido, status, ordenação)", async () => {
    instalarFetchFalso({ "GET /api/crm/visoes": { corpo: { visoes: [] } } });
    const usuario = userEvent.setup();
    const { rerender } = render(<TabelaTerritorio tela="territorio" base="/crm/territorio" ufs={["PR"]} {...tabela()} />);
    await usuario.click(screen.getByRole("checkbox", { name: "Pequeno Porte" }));
    expect(pushMock).toHaveBeenLastCalledWith("/crm/territorio?uf=PR&plano=pequeno_porte");
    rerender(<TabelaTerritorio tela="territorio" base="/crm/territorio" ufs={["PR"]} {...tabela({ filtros: { ...FILTROS_VAZIOS, uf: "PR", planos: ["pequeno_porte"] } })} />);
    await usuario.click(screen.getByRole("checkbox", { name: "Sem plano definido" }));
    expect(pushMock).toHaveBeenLastCalledWith("/crm/territorio?uf=PR&plano=pequeno_porte%2Csem_plano");
    await usuario.click(screen.getByRole("checkbox", { name: /Ignorar plano sugerido/ }));
    expect(pushMock).toHaveBeenLastCalledWith("/crm/territorio?uf=PR&plano=pequeno_porte&ignorar_sugerido=1");
    await usuario.selectOptions(screen.getByLabelText("Status"), "nao_abordado");
    expect(pushMock).toHaveBeenLastCalledWith("/crm/territorio?uf=PR&plano=pequeno_porte&status=nao_abordado");
    await usuario.click(screen.getByRole("button", { name: "População" }));
    expect(pushMock).toHaveBeenLastCalledWith("/crm/territorio?uf=PR&plano=pequeno_porte&ordenar=populacao");
  }, TEMPO);

  it("seleção múltipla → 'Criar leads para os selecionados (N)' manda os códigos marcados na prévia", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/crm/visoes": { corpo: { visoes: [] } }, "POST /api/territorio/leads": { corpo: { criar: [], pulados: [] } } });
    const usuario = userEvent.setup();
    render(<TabelaTerritorio tela="territorio" base="/crm/territorio" ufs={["PR"]} {...tabela()} />);
    expect((screen.getByRole("button", { name: "Criar leads para os selecionados (0)" }) as HTMLButtonElement).disabled).toBe(true);
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar Abatiá" }));
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar Toledo" }));
    await usuario.click(screen.getByRole("button", { name: "Criar leads para os selecionados (2)" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST")).toBe(true));
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ acao: "previa", alvo: { modo: "selecao", codigos: ["4100103", "4127700"] } });
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar todas desta página" }));
    expect(screen.getByRole("button", { name: "Criar leads para os selecionados (4)" })).toBeTruthy();
  }, TEMPO);

  it("avisos de filtro ignorado aparecem (filtro salvo com entidade removida não quebra a tela)", () => {
    instalarFetchFalso({ "GET /api/crm/visoes": { corpo: { visoes: [] } } });
    render(<TabelaTerritorio tela="territorio" base="/crm/territorio" ufs={["PR"]} {...tabela({ avisos: ["A entidade deste filtro não existe mais (ou foi desativada) — filtro ignorado."] })} />);
    expect(screen.getByRole("status", { name: "Avisos dos filtros" }).textContent).toMatch(/não existe mais/);
  }, TEMPO);
});

describe("visão salva", () => {
  it("lista as minhas, abre com um clique e salva SÓ os filtros que a tela entende", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/crm/visoes": { corpo: { visoes: [{ id: "v1", nome: "Pequeno porte no consórcio X", filtros: { uf: "PR", plano: "pequeno_porte" } }] } },
      "POST /api/crm/visoes": { status: 201, corpo: { id: "v2" } }
    });
    const usuario = userEvent.setup();
    render(<VisoesSalvas tela="territorio" queryAtual="uf=PR&status=cliente&pagina=3&lixo=1" base="/crm/territorio" permitidos={PARAMETROS_POR_TELA.territorio} />);
    const link = await screen.findByRole("link", { name: "Pequeno porte no consórcio X" });
    expect(link.getAttribute("href")).toBe("/crm/territorio?uf=PR&plano=pequeno_porte");
    await usuario.type(screen.getByLabelText("Salvar os filtros atuais como"), "Clientes PR");
    await usuario.click(screen.getByRole("button", { name: "Salvar visão" }));
    await screen.findByText("Visão salva.");
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ nome: "Clientes PR", tela: "territorio", filtros: { uf: "PR", status: "cliente" } });
  }, TEMPO);
});

describe("lista de leads — filtro de PLANO", () => {
  it("marcar planos e 'ignorar sugerido' vai pra API; cada linha mostra a origem do plano", async () => {
    const lead = {
      id: "l1", municipio_nome: "Arapongas", uf: "PR", codigo_ibge: null, populacao: 120_000, plano_interesse: null, valor_mensal_estimado_centavos: null, contato_nome: null, contato_cargo: null,
      contato_email: null, contato_telefone: null, origem: "site", etapa: "novo", vendedor_id: "v1", vendedor_nome: "Vera", motivo_perda: null, detalhe_perda: null, proxima_acao_em: null,
      proxima_acao_descricao: null, versao: 1, criado_em: "2026-11-01T12:00:00.000Z", atualizado_em: "2026-11-01T12:00:00.000Z", ultima_atividade_em: "2026-11-01T12:00:00.000Z",
      dias_sem_atividade: 1, parado: false, acao_vencida: false, ex_cliente: false, ex_cliente_encerrado_em: null, plano_efetivo: { id: "medio_porte", origem: "sugerido", sugerido: "medio_porte", divergente: false }, populacao_considerada: 120_000
    };
    const chamadas = instalarFetchFalso({ "GET /api/leads": { corpo: { leads: [lead], total: 1 } }, "GET /api/crm/visoes": { corpo: { visoes: [] } } });
    const usuario = userEvent.setup();
    render(<ListaLeads admin={false} vendedores={[]} queryInicial="plano=medio_porte" entidades={[{ id: "e1", nome: "Assoc", sigla: "A" }]} />);
    const linha = (await screen.findByText("Arapongas — PR")).closest("tr")!;
    expect(within(linha).getByTestId("origem-plano").textContent).toBe("sugerido pela população");
    expect((screen.getByRole("checkbox", { name: "Médio Porte" }) as HTMLInputElement).checked).toBe(true); // veio da URL
    await usuario.click(screen.getByRole("checkbox", { name: "Dispensa" }));
    await usuario.click(screen.getByRole("checkbox", { name: "Ignorar plano sugerido pela população" }));
    await waitFor(() => expect(chamadas.at(-1)!.url).toMatch(/plano=medio_porte%2Cdispensa&ignorar_sugerido=true/));
    expect(window.location.search).toMatch(/visao=lista.*plano=medio_porte%2Cdispensa/);
    expect(screen.getByTestId("contagem-leads").textContent).toBe("1 lead");
  }, TEMPO);
});
