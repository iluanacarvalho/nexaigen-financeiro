// Município da BASE no lead (rodada 16-A3): cadastro em estado liberado
// escolhe o município na base (preenche e trava, "Trocar município"); estado
// não liberado continua livre; detalhe do lead sem código mostra "Vincular ao
// município" (e nada de etiqueta de entidade); admin vê "N leads sem município
// vinculado". Fetch falso; router mockado; timeout explícito (digitação).

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";
import type { LeadListado, ResumoCrm } from "@/lib/crmRepositorio";
import { ETAPAS, calcularTaxasDeAvanco, type Etapa } from "@/lib/crm";

const { pushMock, refreshMock } = vi.hoisted(() => ({ pushMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }), usePathname: () => "/crm" }));

import FormNovoLead from "./novo/FormNovoLead";
import DetalheLead from "./[id]/DetalheLead";
import PainelCrm from "./PainelCrm";

const TEMPO = 20_000;
const TOLEDO = { codigo_ibge: "4127700", nome: "Toledo", uf: "PR", populacao: 162_658 };

const lead = (extra: Partial<LeadListado> = {}): LeadListado => ({
  id: "l1", municipio_nome: "Prefeitura de Toledo", uf: "PR", codigo_ibge: null, populacao: null, plano_interesse: null, valor_mensal_estimado_centavos: null,
  contato_nome: null, contato_cargo: null, contato_email: null, contato_telefone: null, origem: "site", etapa: "contato", vendedor_id: "v1", vendedor_nome: "Vera Vendas",
  motivo_perda: null, detalhe_perda: null, proxima_acao_em: null, proxima_acao_descricao: null, versao: 4, criado_em: "2026-11-01T12:00:00.000Z",
  atualizado_em: "2026-11-01T12:00:00.000Z", ultima_atividade_em: "2026-11-01T12:00:00.000Z", dias_sem_atividade: 1, parado: false, acao_vencida: false,
  ex_cliente: false, ex_cliente_encerrado_em: null, plano_efetivo: { id: null, origem: "sem_plano", sugerido: null, divergente: false }, populacao_considerada: null, ...extra
});

describe("cadastro de lead — município da base", () => {
  it("estado LIBERADO: busca na base, escolhe, fica travado com 'Trocar município' e o envio leva código, nome e população da base", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/leads/consulta": { corpo: { leads: [], total: 0 } },
      "GET /api/municipios": { corpo: { municipios: [TOLEDO] } },
      "POST /api/leads": { status: 201, corpo: { id: "novo" } }
    });
    const usuario = userEvent.setup();
    render(<FormNovoLead admin={false} vendedores={[]} eu="v1" ufsLiberadas={["PR"]} />);
    await usuario.selectOptions(screen.getByLabelText("UF"), "PR");
    expect(screen.queryByLabelText("Código IBGE (7 dígitos, opcional)")).toBeNull(); // vem da base
    await usuario.type(screen.getByLabelText(/Município \(busque na base de PR\)/), "tol");
    await usuario.click(await screen.findByRole("button", { name: /Toledo — PR/ }));
    const escolhido = screen.getByTestId("municipio-escolhido");
    expect(escolhido.textContent).toContain("Toledo — PR");
    expect(escolhido.textContent).toContain("Código IBGE 4127700 · 162.658 hab.");
    expect(chamadas.some((c) => c.url.startsWith("/api/municipios?busca=tol&uf=PR"))).toBe(true);
    await usuario.selectOptions(screen.getByLabelText("Origem"), "site");
    await usuario.click(screen.getByRole("button", { name: "Cadastrar lead" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST")).toBe(true));
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toMatchObject({ municipio_nome: "Toledo", uf: "PR", codigo_ibge: "4127700", populacao: 162_658 });
    expect(pushMock).toHaveBeenCalledWith("/crm/novo");

    // "Trocar município" destrava e volta pra busca.
    await usuario.click(within(screen.getByTestId("municipio-escolhido")).getByRole("button", { name: "Trocar município" }));
    expect(screen.getByLabelText(/Município \(busque na base de PR\)/)).toBeTruthy();
  }, TEMPO);

  it("estado liberado SEM escolher: não envia, avisa; estado NÃO liberado: campos livres de sempre", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/leads/consulta": { corpo: { leads: [], total: 0 } }, "GET /api/municipios": { corpo: { municipios: [] } } });
    const usuario = userEvent.setup();
    render(<FormNovoLead admin={false} vendedores={[]} eu="v1" ufsLiberadas={["PR"]} />);
    await usuario.selectOptions(screen.getByLabelText("UF"), "PR");
    await usuario.selectOptions(screen.getByLabelText("Origem"), "site");
    await usuario.click(screen.getByRole("button", { name: "Cadastrar lead" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Escolha o município na lista (estado liberado no Território).");
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);
    await usuario.selectOptions(screen.getByLabelText("UF"), "SC");
    expect(screen.getByLabelText("Município")).toBeTruthy();
    expect(screen.getByLabelText("Código IBGE (7 dígitos, opcional)")).toBeTruthy();
  }, TEMPO);
});

describe("detalhe do lead — vincular ao município", () => {
  it("lead SEM código em estado liberado: aviso, nada de etiqueta, 'Vincular ao município' manda versão e código", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/municipios": { corpo: { municipios: [TOLEDO] } }, "POST /api/leads/l1/municipio": { corpo: { versao: 5 } } });
    const usuario = userEvent.setup();
    render(<DetalheLead lead={lead()} historico={[]} admin={false} vendedores={[]} entidades={[]} ufsLiberadas={["PR"]} />);
    expect(screen.getByTestId("sem-municipio").textContent).toBe("Sem município vinculado — vincular município.");
    expect(screen.queryByTestId("etiqueta-entidade")).toBeNull();
    const secao = screen.getByRole("region", { name: "Vincular ao município" });
    expect((within(secao).getByRole("button", { name: "Vincular ao município" }) as HTMLButtonElement).disabled).toBe(true);
    await usuario.type(within(secao).getByRole("textbox"), "toledo");
    await usuario.click(await within(secao).findByRole("button", { name: /Toledo — PR/ }));
    await usuario.click(within(secao).getByRole("button", { name: "Vincular ao município" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST")).toBe(true));
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ versao: 4, codigo_ibge: "4127700" });
    expect(refreshMock).toHaveBeenCalled();
  }, TEMPO);

  it("lead COM código: etiquetas das entidades e nenhuma oferta de vincular; estado não liberado: só o aviso", () => {
    instalarFetchFalso({});
    const { unmount } = render(
      <DetalheLead lead={lead({ codigo_ibge: "4127700", municipio_nome: "Toledo" })} historico={[]} admin={false} vendedores={[]} entidades={[{ id: "e1", nome: "Assoc", sigla: "AMOP", clientes: 2 }]} ufsLiberadas={["PR"]} />
    );
    expect(screen.getByTestId("etiqueta-entidade").textContent).toBe("AMOP · 2 prefeituras desta entidade já são clientes");
    expect(screen.queryByRole("region", { name: "Vincular ao município" })).toBeNull();
    unmount();
    render(<DetalheLead lead={lead({ uf: "SC" })} historico={[]} admin={false} vendedores={[]} entidades={[]} ufsLiberadas={["PR"]} />);
    expect(screen.getByTestId("sem-municipio").textContent).toBe("Sem município vinculado — a base deste estado ainda não está liberada.");
    expect(screen.queryByRole("region", { name: "Vincular ao município" })).toBeNull();
  }, TEMPO);
});

describe("admin — leads sem município vinculado", () => {
  const resumo = (leadsSemMunicipio: number | null): ResumoCrm => ({
    hoje: "2026-11-18",
    abertos: { quantidade: 0, valorCentavos: 0 },
    porEtapa: ETAPAS.map((etapa) => ({ etapa, quantidade: 0, valorCentavos: 0 })),
    ganhosNoMes: 0,
    perdidosNoMes: 0,
    taxasDeAvanco: calcularTaxasDeAvanco([]),
    minhasAcoes: [],
    cargaPorVendedor: [],
    pedidosPendentes: [],
    leadsSemMunicipio
  });
  const funil = Object.fromEntries(ETAPAS.map((e) => [e, []])) as unknown as Record<Etapa, LeadListado[]>;

  it("mostra a contagem com o link pra lista filtrada; sem nenhum (ou pra vendas, null) não mostra", () => {
    instalarFetchFalso({});
    const { unmount } = render(<PainelCrm resumo={resumo(7)} funil={funil} admin vendedores={[]} />);
    const aviso = screen.getByTestId("aviso-sem-municipio");
    expect(aviso.textContent).toMatch(/^7 leads sem município vinculado/);
    expect(within(aviso).getByRole("link", { name: "Ver e vincular" }).getAttribute("href")).toBe("/crm?visao=lista&sem_municipio=true");
    unmount();
    const { unmount: u2 } = render(<PainelCrm resumo={resumo(0)} funil={funil} admin vendedores={[]} />);
    expect(screen.queryByTestId("aviso-sem-municipio")).toBeNull();
    u2();
    render(<PainelCrm resumo={resumo(null)} funil={funil} admin={false} vendedores={[]} />);
    expect(screen.queryByTestId("aviso-sem-municipio")).toBeNull();
  }, TEMPO);
});
