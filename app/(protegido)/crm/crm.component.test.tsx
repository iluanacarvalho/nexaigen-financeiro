// Telas do CRM (rodada 16-A): funil (colunas com contagem e soma), cartão
// com selos, "Mover para…" (sem arrastar; perder exige motivo; 'ganho' nem
// aparece), números do topo (ganhos "—" com legenda, taxa "—" sem base),
// "Minhas ações de hoje", pedidos (admin), lista com filtros no servidor,
// estado vazio, "Já existe esse lead?" com "Pedir este lead", cadastro
// bloqueado por duplicidade e com preço sugerido, registrar contato com o
// aviso de LGPD, linha do tempo. Fetch falso; router mockado.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";
import type { LeadListado, ResumoCrm } from "@/lib/crmRepositorio";
import { AVISO_LGPD, ETAPAS, calcularTaxasDeAvanco, type Etapa } from "@/lib/crm";

const { refreshMock, pushMock } = vi.hoisted(() => ({ refreshMock: vi.fn(), pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock, push: pushMock }) }));

import PainelCrm from "./PainelCrm";
import ConsultaLead from "./ConsultaLead";
import FormNovoLead from "./novo/FormNovoLead";
import DetalheLead from "./[id]/DetalheLead";

const lead = (extra: Partial<LeadListado>): LeadListado => ({
  id: "l1", municipio_nome: "Arapongas", uf: "PR", codigo_ibge: null, populacao: null, plano_interesse: null, valor_mensal_estimado_centavos: 850000,
  contato_nome: "Secretária Ana", contato_cargo: null, contato_email: null, contato_telefone: null, origem: "indicacao", etapa: "novo",
  vendedor_id: "v1", vendedor_nome: "Vera Vendas", motivo_perda: null, detalhe_perda: null, proxima_acao_em: null, proxima_acao_descricao: null,
  versao: 3, criado_em: "2026-11-01T12:00:00.000Z", atualizado_em: "2026-11-01T12:00:00.000Z", ultima_atividade_em: "2026-11-01T12:00:00.000Z",
  dias_sem_atividade: 17, parado: true, acao_vencida: true, ex_cliente: false, ex_cliente_encerrado_em: null,
  plano_efetivo: { id: null, origem: "sem_plano", sugerido: null, divergente: false }, populacao_considerada: null, ...extra
});

const ABERTOS = [
  lead({ id: "l1" }),
  lead({ id: "l2", municipio_nome: "Cambé", etapa: "proposta", valor_mensal_estimado_centavos: 1500000, parado: false, acao_vencida: false, dias_sem_atividade: 2 })
];

/** Cartões do funil por etapa (o que listarFunil devolve). */
function funilDe(abertos: LeadListado[], perdidos: LeadListado[]): Record<Etapa, LeadListado[]> {
  const funil = Object.fromEntries(ETAPAS.map((e) => [e, [] as LeadListado[]])) as Record<Etapa, LeadListado[]>;
  for (const l of [...abertos, ...perdidos]) funil[l.etapa].push(l);
  return funil;
}

function resumo(extra: Partial<ResumoCrm> = {}): ResumoCrm {
  return {
    hoje: "2026-11-18",
    abertos: { quantidade: 2, valorCentavos: 2350000 },
    porEtapa: [
      { etapa: "novo", quantidade: 1, valorCentavos: 850000 },
      { etapa: "contato", quantidade: 0, valorCentavos: 0 },
      { etapa: "demonstracao", quantidade: 0, valorCentavos: 0 },
      { etapa: "proposta", quantidade: 1, valorCentavos: 1500000 },
      { etapa: "negociacao", quantidade: 0, valorCentavos: 0 },
      { etapa: "ganho", quantidade: 0, valorCentavos: 0 },
      { etapa: "perdido", quantidade: 1, valorCentavos: 0 }
    ],
    ganhosNoMes: null,
    perdidosNoMes: 1,
    taxasDeAvanco: calcularTaxasDeAvanco([["novo"], ["novo", "proposta"]]),
    minhasAcoes: [{ id: "l1", municipio_nome: "Arapongas", uf: "PR", etapa: "novo", proxima_acao_em: "2026-11-17", proxima_acao_descricao: "Ligar para a secretária" }],
    cargaPorVendedor: null,
    pedidosPendentes: null,
    leadsSemMunicipio: null,
    ...extra
  };
}

describe("CRM — funil", () => {
  it("colunas por etapa com contagem e soma; cartão com contato, valor e selos; vendedor só pro admin", () => {
    const { unmount } = render(<PainelCrm resumo={resumo()} funil={funilDe(ABERTOS, [lead({ id: "p1", municipio_nome: "Rolândia", etapa: "perdido", motivo_perda: "preco" })])} admin={false} vendedores={[]} />);
    const novo = screen.getByRole("region", { name: "Etapa Novo" });
    expect(within(novo).getByRole("heading").textContent).toBe("Novo (1)");
    expect(within(novo).getByTestId("soma-novo").textContent).toMatch(/R\$\s*8\.500,00\/mês/);
    const cartao = within(novo).getByTestId("cartao-l1");
    expect(cartao.textContent).toContain("Secretária Ana");
    expect(within(cartao).getByTestId("selo-parado").textContent).toBe("parado há 17 dias");
    expect(within(cartao).getByTestId("selo-acao-vencida")).toBeTruthy();
    expect(cartao.textContent).not.toContain("Vendedor:");
    expect(within(screen.getByRole("region", { name: "Etapa Proposta" })).queryByTestId("selo-parado")).toBeNull();
    expect(screen.getByText("Perdidos (1)").closest("details")!.hasAttribute("open")).toBe(false); // recolhido
    unmount();
    render(<PainelCrm resumo={resumo()} funil={funilDe(ABERTOS, [])} admin vendedores={[]} />);
    expect(screen.getByTestId("cartao-l1").textContent).toContain("Vendedor: Vera Vendas");
  });

  it("sem corte silencioso: 120 leads em Contato → coluna mostra 50 cartões, total 120 e 'Ver todos' abre a lista filtrada", () => {
    const cinquenta = Array.from({ length: 50 }, (_, i) => lead({ id: `c${i}`, municipio_nome: `Município ${i}`, etapa: "contato" }));
    const base = resumo();
    const r = resumo({ porEtapa: base.porEtapa.map((e) => (e.etapa === "contato" ? { etapa: "contato", quantidade: 120, valorCentavos: 102000000 } : e)) });
    render(<PainelCrm resumo={r} funil={funilDe([...ABERTOS, ...cinquenta], [])} admin={false} vendedores={[]} />);
    const coluna = screen.getByRole("region", { name: "Etapa Contato" });
    expect(within(coluna).getByRole("heading").textContent).toBe("Contato (120)");
    expect(within(coluna).getAllByRole("listitem")).toHaveLength(50);
    const link = within(coluna).getByTestId("ver-todos-contato");
    expect(link.textContent).toBe("Ver todos os 120 desta etapa (mostrando 50)");
    expect(link.getAttribute("href")).toBe("/crm?visao=lista&etapa=contato");
    // Coluna que mostra tudo não tem o link.
    expect(within(screen.getByRole("region", { name: "Etapa Novo" })).queryByTestId("ver-todos-novo")).toBeNull();
  });

  it("'Ver todos' chega na LISTA já filtrada pela etapa (visao=lista&etapa=…)", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/leads": { corpo: { leads: [], total: 0 } } });
    render(<PainelCrm resumo={resumo()} funil={funilDe(ABERTOS, [])} admin={false} vendedores={[]} visaoInicial="lista" etapaInicial="contato" />);
    await waitFor(() => expect(chamadas.some((c) => c.url.startsWith("/api/leads?") && c.url.includes("etapa=contato"))).toBe(true));
    expect((within(screen.getByRole("form", { name: "Filtros de leads" })).getByLabelText("Etapa") as HTMLSelectElement).value).toBe("contato");
  });

  it("ex-cliente: selo com a data do encerramento no cartão (e sem data quando não há registro)", () => {
    render(
      <PainelCrm
        resumo={resumo()}
        funil={funilDe([lead({ id: "e1", ex_cliente: true, ex_cliente_encerrado_em: "2026-03-31" }), lead({ id: "e2", municipio_nome: "Cambé", etapa: "proposta", ex_cliente: true })], [])}
        admin={false}
        vendedores={[]}
      />
    );
    expect(within(screen.getByTestId("cartao-e1")).getByTestId("selo-ex-cliente").textContent).toBe("ex-cliente · encerrado em 31/03/2026");
    expect(within(screen.getByTestId("cartao-e2")).getByTestId("selo-ex-cliente").textContent).toBe("ex-cliente · data do encerramento não registrada");
  });

  it("números: ganhos '—' com legenda da 16-B; taxa '—' quando ninguém entrou; minhas ações de hoje", () => {
    render(<PainelCrm resumo={resumo()} funil={funilDe(ABERTOS, [])} admin={false} vendedores={[]} />);
    const numeros = screen.getByRole("region", { name: "Números do funil" });
    expect(numeros.textContent).toMatch(/Ganhos no mês—O fechamento \(lead → cliente\) entra na rodada 16-B\./);
    expect(screen.getByTestId("taxa-novo").textContent).toMatch(/Novo → Contato: 50%/);
    expect(screen.getByTestId("taxa-negociacao").textContent).toMatch(/Negociação → Ganho: — \(0 de 0\)/);
    const acoes = screen.getByRole("region", { name: "Minhas ações de hoje" });
    expect(acoes.textContent).toMatch(/Arapongas — PR · vencida em 17\/11\/2026 · Ligar para a secretária/);
  });

  it("Mover para…: 'ganho' não é opção; mover chama a API; perdido exige motivo antes de enviar", async () => {
    const chamadas = instalarFetchFalso({ "POST /api/leads/l1/etapa": { corpo: { etapa: "contato", versao: 4 } } });
    const usuario = userEvent.setup();
    render(<PainelCrm resumo={resumo()} funil={funilDe(ABERTOS, [])} admin={false} vendedores={[]} />);
    const form = screen.getByRole("form", { name: "Mover Arapongas" });
    const select = within(form).getByLabelText("Mover Arapongas para") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", "contato", "demonstracao", "proposta", "negociacao", "perdido"]);
    await usuario.selectOptions(select, "contato");
    await usuario.click(within(form).getByRole("button", { name: "Mover" }));
    await waitFor(() => expect(chamadas.find((c) => c.metodo === "POST")?.corpo).toEqual({ acao: "mover", etapa: "contato" }));
    expect(refreshMock).toHaveBeenCalled();

    await usuario.selectOptions(select, "perdido");
    expect((within(form).getByRole("button", { name: "Mover" }) as HTMLButtonElement).disabled).toBe(true);
    await usuario.selectOptions(within(form).getByLabelText("Motivo da perda"), "sem_resposta");
    await usuario.type(within(form).getByLabelText("Detalhe (opcional)"), "3 tentativas");
    await usuario.click(within(form).getByRole("button", { name: "Mover" }));
    await waitFor(() => expect(chamadas.filter((c) => c.metodo === "POST").at(-1)?.corpo).toEqual({ acao: "perder", motivo: "sem_resposta", detalhe: "3 tentativas" }));
  });

  it("estado vazio amigável", () => {
    render(<PainelCrm resumo={resumo({ abertos: { quantidade: 0, valorCentavos: 0 }, minhasAcoes: [], porEtapa: ETAPAS.map((etapa) => ({ etapa, quantidade: 0, valorCentavos: 0 })) })} funil={funilDe([], [])} admin={false} vendedores={[]} />);
    expect(screen.getByText("Nenhum lead ainda.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Cadastrar lead" }).getAttribute("href")).toBe("/crm/novo");
  });

  it("admin: pedidos de reatribuição com Aprovar/Negar e carga por vendedor", async () => {
    const chamadas = instalarFetchFalso({ "POST /api/leads/pedidos/pd1": { corpo: { decisao: "aprovado" } } });
    const usuario = userEvent.setup();
    render(
      <PainelCrm
        resumo={resumo({
          pedidosPendentes: [{ id: "pd1", lead_id: "l9", municipio_nome: "Rolândia", uf: "PR", dono_nome: "Beto", solicitante_nome: "Vera", em: "2026-11-18T10:00:00.000Z" }],
          cargaPorVendedor: [{ vendedor_id: "v1", vendedor_nome: "Vera Vendas", abertos: 2, valorCentavos: 2350000 }]
        })}
        funil={funilDe(ABERTOS, [])}
        admin
        vendedores={[]}
      />
    );
    const pedidos = screen.getByRole("region", { name: "Pedidos de reatribuição" });
    expect(pedidos.textContent).toMatch(/Vera pede Rolândia — PR \(hoje com Beto\)/);
    await usuario.click(within(pedidos).getByRole("button", { name: "Aprovar" }));
    await waitFor(() => expect(chamadas.find((c) => c.metodo === "POST")?.corpo).toEqual({ decisao: "aprovado" }));
    expect(screen.getByRole("region", { name: "Carga por vendedor" }).textContent).toMatch(/Vera Vendas2R\$\s*23\.500,00/);
  });

  it("lista: filtros vão pro servidor; sem resultado com filtro mostra a mensagem certa", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/leads": { corpo: { leads: [], total: 0 } } });
    const usuario = userEvent.setup();
    render(<PainelCrm resumo={resumo()} funil={funilDe(ABERTOS, [])} admin={false} vendedores={[]} />);
    await usuario.click(screen.getByRole("button", { name: "Lista" }));
    const filtros = screen.getByRole("form", { name: "Filtros de leads" });
    expect(within(filtros).queryByLabelText("Vendedor")).toBeNull(); // só admin
    await usuario.selectOptions(within(filtros).getByLabelText("UF"), "PR");
    await usuario.click(within(filtros).getByLabelText("Só parados (+14 dias)"));
    await waitFor(() => expect(chamadas.some((c) => c.url.includes("uf=PR") && c.url.includes("parados=true"))).toBe(true));
    expect(await screen.findByText("Nenhum lead com estes filtros.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Exportar CSV" })).toBeNull(); // exportar: só admin
  });
});

describe("CRM — Já existe esse lead?", () => {
  it("mostra 'já está com <vendedor>, etapa <etapa>' (só campos mínimos) e o botão 'Pedir este lead' quando pode", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/leads/consulta": {
        corpo: {
          leads: [{ id: "l9", municipio_nome: "Jaguapitã", uf: "PR", etapa: "proposta", vendedor_nome: "Beto Vendas", ultima_atividade_em: "2026-08-01", meu_lead: false, pode_pedir: true }],
          total: 1
        }
      },
      "POST /api/leads/l9/pedidos": { status: 201, corpo: { id: "pd1" } }
    });
    const usuario = userEvent.setup();
    render(<ConsultaLead />);
    await usuario.type(screen.getByRole("textbox", { name: "Já existe esse lead?" }), "jaguapita");
    const resultado = await screen.findByTestId("resultado-consulta");
    expect(chamadas.some((c) => c.url.startsWith("/api/leads/consulta?busca=jaguapita"))).toBe(true);
    expect(resultado.textContent).toMatch(/Jaguapitã — PR.*Já existe esse lead: está com Beto Vendas, etapa Proposta\. Última atividade: 01\/08\/2026\./);
    await usuario.click(within(resultado).getByRole("button", { name: "Pedir este lead" }));
    expect(await within(resultado).findByText("Pedido enviado — o administrador vai decidir.")).toBeTruthy();
  });
});

describe("CRM — cadastro", () => {
  it("duplicidade em tempo real BLOQUEIA o envio; plano sugere o preço (editável)", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/leads/consulta": { corpo: { leads: [{ id: "l9", municipio_nome: "Jaguapitã", uf: "PR", etapa: "novo", vendedor_nome: "Beto Vendas", ultima_atividade_em: "2026-11-10", meu_lead: false, pode_pedir: false }], total: 1 } }
    });
    const usuario = userEvent.setup();
    render(<FormNovoLead admin={false} vendedores={[]} eu="v1" />);
    const form = screen.getByRole("form", { name: "Novo lead" });
    await usuario.selectOptions(within(form).getByLabelText("Plano de interesse"), "pequeno_porte");
    expect((within(form).getByLabelText(/^Valor mensal estimado \(R\$\)/) as HTMLInputElement).value).toBe("8500,00");
    await usuario.type(within(form).getByLabelText("Município"), "JAGUAPITA");
    await usuario.selectOptions(within(form).getByLabelText("UF"), "PR");
    expect((await within(form).findByRole("alert")).textContent).toMatch(/Já existe esse lead: está com Beto Vendas, etapa Novo\./);
    expect((within(form).getByRole("button", { name: "Cadastrar lead" }) as HTMLButtonElement).disabled).toBe(true);
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);
    expect(within(form).queryByLabelText("Vendedor")).toBeNull(); // vendas cria sempre pra si
  });

  it("sem duplicado: envia e vai pro detalhe do lead novo", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/leads/consulta": { corpo: { leads: [], total: 0 } }, "POST /api/leads": { status: 201, corpo: { id: "novo1" } } });
    const usuario = userEvent.setup();
    render(<FormNovoLead admin={false} vendedores={[]} eu="v1" />);
    const form = screen.getByRole("form", { name: "Novo lead" });
    await usuario.type(within(form).getByLabelText("Município"), "Sertanópolis");
    await usuario.selectOptions(within(form).getByLabelText("UF"), "PR");
    await usuario.selectOptions(within(form).getByLabelText("Origem"), "evento");
    await usuario.click(within(form).getByRole("button", { name: "Cadastrar lead" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/novo1"));
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toMatchObject({ municipio_nome: "Sertanópolis", uf: "PR", origem: "evento", valor_mensal_estimado: null });
  });
});

describe("CRM — detalhe", () => {
  const HISTORICO = [
    { id: "h2", tipo: "ligacao", texto: "Retornou a ligação", etapa_anterior: null, etapa_nova: null, autor_nome: "Vera Vendas", em: "2026-11-10T13:00:00.000Z" },
    { id: "h1", tipo: "mudanca_etapa", texto: null, etapa_anterior: "novo", etapa_nova: "contato", autor_nome: "Vera Vendas", em: "2026-11-05T13:00:00.000Z" }
  ];

  it("registrar contato: aviso de LGPD fixo; envia tipo + texto; linha do tempo do mais recente pro mais antigo", async () => {
    const chamadas = instalarFetchFalso({ "POST /api/leads/l1/interacoes": { status: 201, corpo: { id: "h3" } } });
    const usuario = userEvent.setup();
    render(<DetalheLead lead={lead({})} historico={HISTORICO} admin={false} vendedores={[]} />);
    const form = screen.getByRole("form", { name: "Registrar contato" });
    expect(within(form).getByTestId("aviso-lgpd").textContent).toBe(AVISO_LGPD);
    expect(within(form).getByLabelText("O que aconteceu").getAttribute("aria-describedby")).toBe("aviso-lgpd-l1");
    await usuario.selectOptions(within(form).getByLabelText("Tipo"), "whatsapp");
    await usuario.type(within(form).getByLabelText("O que aconteceu"), "Enviou a proposta");
    await usuario.click(within(form).getByRole("button", { name: "Registrar contato" }));
    await waitFor(() => expect(chamadas.find((c) => c.metodo === "POST")?.corpo).toEqual({ tipo: "whatsapp", texto: "Enviou a proposta" }));
    const itens = within(screen.getByRole("list", { name: "Histórico do lead" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(itens[0]).toMatch(/^Ligação/);
    expect(itens[1]).toMatch(/^Mudança de etapa · Novo → Contato/);
    expect(screen.queryByRole("form", { name: "Trocar vendedor" })).toBeNull(); // só admin
  });

  it("edição com versão: manda a versão lida; 409 'recarregue' aparece", async () => {
    const chamadas = instalarFetchFalso({ "PATCH /api/leads/l1": { status: 409, corpo: { erro: "Alguém alterou este lead, recarregue a página para ver a versão atual." } } });
    const usuario = userEvent.setup();
    render(<DetalheLead lead={lead({})} historico={[]} admin={false} vendedores={[]} />);
    const form = screen.getByRole("form", { name: "Definir próxima ação" });
    await usuario.type(within(form).getByLabelText("Data"), "2026-11-25");
    await usuario.type(within(form).getByLabelText("O quê"), "Demonstração");
    await usuario.click(within(form).getByRole("button", { name: "Salvar próxima ação" }));
    await waitFor(() => expect(chamadas.find((c) => c.metodo === "PATCH")?.corpo).toEqual({ versao: 3, proxima_acao_em: "2026-11-25", proxima_acao_descricao: "Demonstração" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/alterou este lead, recarregue/);
    expect(screen.getByText(/Nenhum registro ainda/)).toBeTruthy();
  });

  it("editar dados: o formulário cobre todos os campos cadastrais (inclusive UF, população, plano e origem) e manda a versão", async () => {
    const chamadas = instalarFetchFalso({ "PATCH /api/leads/l1": { corpo: { versao: 4, alterados: ["uf", "plano_interesse"] } } });
    const usuario = userEvent.setup();
    render(<DetalheLead lead={lead({})} historico={[]} admin={false} vendedores={[]} />);
    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    const form = screen.getByRole("form", { name: "Editar lead" });
    await usuario.selectOptions(within(form).getByLabelText("UF"), "SC");
    await usuario.selectOptions(within(form).getByLabelText("Plano de interesse"), "medio_porte");
    await usuario.type(within(form).getByLabelText("População"), "52000");
    await usuario.click(within(form).getByRole("button", { name: "Salvar dados" }));
    await waitFor(() => expect(chamadas.find((c) => c.metodo === "PATCH")?.corpo).toMatchObject({ versao: 3, uf: "SC", plano_interesse: "medio_porte", populacao: 52000, origem: "indicacao", municipio_nome: "Arapongas" }));
  });

  it("ex-cliente também aparece na LISTA e no DETALHE, com a data do encerramento", async () => {
    instalarFetchFalso({ "GET /api/leads": { corpo: { leads: [lead({ id: "x1", ex_cliente: true, ex_cliente_encerrado_em: "2026-03-31" })], total: 1 } } });
    const { unmount } = render(<PainelCrm resumo={resumo()} funil={funilDe(ABERTOS, [])} admin={false} vendedores={[]} visaoInicial="lista" />);
    const lista = screen.getByRole("region", { name: "Lista de leads" });
    const linha = (await within(lista).findByRole("link", { name: "Arapongas — PR" })).closest("tr")!;
    expect(within(linha).getByTestId("selo-ex-cliente").textContent).toBe("ex-cliente · encerrado em 31/03/2026");
    unmount();
    render(<DetalheLead lead={lead({ ex_cliente: true, ex_cliente_encerrado_em: "2026-03-31" })} historico={[]} admin={false} vendedores={[]} />);
    expect(screen.getByTestId("selo-ex-cliente").textContent).toBe("ex-cliente · encerrado em 31/03/2026");
  });
});
