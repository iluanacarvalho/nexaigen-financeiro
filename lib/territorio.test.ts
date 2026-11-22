// lib/territorio.ts — precedência de STATUS e de PLANO em todas as
// combinações, % de cobertura (denominador zero), filtros na URL (ida e
// volta, valor inválido vira aviso), saneamento, privacidade da linha (lead
// de colega = só etapa e vendedor), ordenação e o lote. Datas fixas.

import { describe, expect, it } from "vitest";
import {
  FILTROS_VAZIOS,
  casaPlano,
  clientesDoMunicipioBase,
  filtrarLinhas,
  lerFiltrosTerritorio,
  montarLinha,
  montarQueryTerritorio,
  motivoParaPular,
  ordenarLinhas,
  percentualCobertura,
  planoEfetivo,
  resumirLinhas,
  rotuloStatusDaLinha,
  sanearFiltros,
  situacaoComercial,
  textoClientesDaEntidade,
  textoClientesNaEtiqueta,
  textoContagem,
  type ClienteDoTerritorio,
  type LeadDoTerritorio,
  type LinhaTerritorio,
  type MunicipioDoTerritorio
} from "./territorio";

const HOJE = "2026-11-18";
const MARINGA: MunicipioDoTerritorio = { codigo_ibge: "4115200", nome: "Maringá", uf: "PR", populacao: 432_635, populacao_ano: 2026, microrregiao: "Maringá", mesorregiao: "Norte Central Paranaense" };

const cliente = (extra: Partial<ClienteDoTerritorio> = {}): ClienteDoTerritorio => ({
  nome: "Prefeitura Municipal de Maringá", uf: "PR", codigo_ibge: "4115200", status_contrato: "ativo", cancelamento_termino_em: null, encerrado_em: null, plano: "grande_porte", data_inicio_contrato: "2026-02-01", ...extra
});
const lead = (extra: Partial<LeadDoTerritorio> = {}): LeadDoTerritorio => ({
  id: "lead-1", municipio_nome: "Maringá", nome_busca: "maringa", uf: "PR", codigo_ibge: "4115200", etapa: "proposta", vendedor_id: "vera", vendedor_nome: "Vera Vendas",
  plano_interesse: "medio_porte", motivo_perda: null, proxima_acao_em: "2026-11-10", atualizado_em: "2026-10-01T15:00:00.000Z", ultima_atividade_em: "2026-10-01T15:00:00.000Z", ...extra
});
const PERDIDO = lead({ id: "lead-0", etapa: "perdido", motivo_perda: "preco", proxima_acao_em: null, atualizado_em: "2026-06-01T15:00:00.000Z" });

describe("STATUS — precedência: cliente (ou ex-cliente) > lead aberto > perdido > não abordado", () => {
  const clientes: [string, ClienteDoTerritorio[]][] = [
    ["nenhum cliente", []],
    ["cliente ativo", [cliente()]],
    ["cliente em aviso prévio (encerrando)", [cliente({ status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-12-01" })]],
    ["cliente suspenso", [cliente({ status_contrato: "suspenso" })]],
    ["cliente encerrado", [cliente({ status_contrato: "encerrado", encerrado_em: "2026-03-31" })]],
    ["aviso prévio vencido (encerrado hoje)", [cliente({ status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-11-17" })]],
    ["um encerrado + um ativo", [cliente({ status_contrato: "encerrado" }), cliente({ codigo_ibge: null })]]
  ];
  const leads: [string, LeadDoTerritorio[]][] = [
    ["sem lead", []],
    ["lead aberto", [lead()]],
    ["lead perdido", [PERDIDO]],
    ["perdido + aberto", [PERDIDO, lead()]]
  ];
  const esperado = (c: string, l: string) => {
    if (["cliente ativo", "cliente em aviso prévio (encerrando)", "cliente suspenso", "um encerrado + um ativo"].includes(c)) return "cliente";
    if (c !== "nenhum cliente") return "ex_cliente";
    if (l === "lead aberto" || l === "perdido + aberto") return "em_negociacao";
    if (l === "lead perdido") return "perdido";
    return "nao_abordado";
  };
  for (const [nc, cs] of clientes) {
    for (const [nl, ls] of leads) {
      it(`${nc} × ${nl} → ${esperado(nc, nl)}`, () => {
        expect(situacaoComercial(cs, ls, HOJE).status).toBe(esperado(nc, nl));
      });
    }
  }

  it("cliente vigente: situação do contrato HOJE; o mais 'vivo' vence (ativo > aviso > suspenso); ex-cliente: data mais recente", () => {
    expect(situacaoComercial([cliente({ status_contrato: "suspenso" }), cliente({ status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-12-01" })], [], HOJE)).toMatchObject({ situacaoContrato: "em_aviso_previo" });
    expect(situacaoComercial([cliente({ status_contrato: "encerrado", encerrado_em: "2025-01-10" }), cliente({ status_contrato: "encerrado", cancelamento_termino_em: "2026-03-30" })], [], HOJE).exClienteEncerradoEm).toBe("2026-03-30");
    expect(situacaoComercial([cliente({ status_contrato: "encerrado" })], [], HOJE).exClienteEncerradoEm).toBeNull();
  });

  it("cliente SEM código casa por UF + nome normalizado (e marca 'corrigir'); com código diferente, não casa", () => {
    const semCodigo = cliente({ codigo_ibge: null, nome: "PREFEITURA DE MARINGA" });
    expect(clientesDoMunicipioBase([semCodigo, cliente({ codigo_ibge: "4113700", nome: "Maringá" }), cliente({ codigo_ibge: null, uf: "SP" })], MARINGA)).toEqual([semCodigo]);
    expect(situacaoComercial([semCodigo], [], HOJE).clienteSemCodigo).toBe(true);
    expect(situacaoComercial([cliente()], [], HOJE).clienteSemCodigo).toBe(false);
  });
});

describe("PLANO EFETIVO — contratado > de interesse > sugerido pela população > sem plano", () => {
  it.each([
    [null, null, null, null, "sem_plano"],
    [null, null, 9_999, "dispensa", "sugerido"],
    [null, null, 10_000, "pequeno_porte", "sugerido"],
    [null, null, 200_000, "grande_porte", "sugerido"],
    [null, "medio_porte", null, "medio_porte", "interesse"],
    [null, "medio_porte", 9_999, "medio_porte", "interesse"],
    ["pequeno_porte", null, null, "pequeno_porte", "contratado"],
    ["pequeno_porte", "grande_porte", 432_635, "pequeno_porte", "contratado"],
    ["grande_porte", "medio_porte", 432_635, "grande_porte", "contratado"]
  ] as const)("contratado %s · interesse %s · população %s → %s (%s)", (contratado, interesse, populacao, id, origem) => {
    expect(planoEfetivo({ planoContratado: contratado, planoInteresse: interesse, populacao })).toMatchObject({ id, origem });
  });

  it("aviso 'plano diferente do sugerido' só pro contratado que diverge da faixa (nunca bloqueia nada)", () => {
    expect(planoEfetivo({ planoContratado: "pequeno_porte", planoInteresse: null, populacao: 432_635 }).divergente).toBe(true);
    expect(planoEfetivo({ planoContratado: "grande_porte", planoInteresse: null, populacao: 432_635 }).divergente).toBe(false);
    expect(planoEfetivo({ planoContratado: "pequeno_porte", planoInteresse: null, populacao: null }).divergente).toBe(false);
    expect(planoEfetivo({ planoContratado: null, planoInteresse: "pequeno_porte", populacao: 432_635 }).divergente).toBe(false);
  });
});

describe("linha do Território — privacidade e conteúdo", () => {
  const vendasBeto = { equipeId: "beto", admin: false };
  it("lead de COLEGA pra vendas: SÓ etapa e vendedor; plano de interesse do colega NÃO vira 'de interesse'", () => {
    const l = montarLinha(MARINGA, [], [lead()], [], vendasBeto, HOJE);
    expect(l.lead).toEqual({ etapa: "proposta", vendedor_nome: "Vera Vendas" });
    expect(l.plano).toMatchObject({ id: "grande_porte", origem: "sugerido" });
    expect(Object.keys(l).sort()).toEqual(["cliente_sem_codigo", "codigo_ibge", "contrato", "entidades", "ex_cliente_encerrado_em", "lead", "mesorregiao", "microrregiao", "nome", "plano", "populacao", "populacao_ano", "status", "uf"]);
  });

  it("o PRÓPRIO lead (ou admin): id, selos, plano de interesse; perdido traz motivo e dia", () => {
    const minha = montarLinha(MARINGA, [], [lead()], [], { equipeId: "vera", admin: false }, HOJE);
    expect(minha.lead).toEqual({ id: "lead-1", etapa: "proposta", vendedor_id: "vera", vendedor_nome: "Vera Vendas", meu: true, parado: true, acao_vencida: true, motivo_perda: null, perdido_em: null });
    expect(minha.plano).toMatchObject({ id: "medio_porte", origem: "interesse" });
    const admin = montarLinha(MARINGA, [], [PERDIDO], [], { equipeId: "ana", admin: true }, HOJE);
    expect(admin.lead).toMatchObject({ meu: false, motivo_perda: "preco", perdido_em: "2026-06-01" });
    expect(admin.plano.origem).toBe("sugerido"); // perdido não vale como "de interesse"
  });

  it("cliente vigente: contrato com situação/plano/início; rótulos de status", () => {
    const l = montarLinha(MARINGA, [cliente({ plano: "pequeno_porte" })], [], [], vendasBeto, HOJE);
    expect(l.contrato).toEqual({ situacao: "ativo", plano: "pequeno_porte", desde: "2026-02-01" });
    expect(l.plano).toMatchObject({ id: "pequeno_porte", origem: "contratado", divergente: true });
    expect(rotuloStatusDaLinha(l)).toBe("Cliente — Ativo");
    expect(rotuloStatusDaLinha(montarLinha(MARINGA, [], [lead()], [], vendasBeto, HOJE))).toBe("Em negociação — Proposta");
  });
});

describe("resumo e textos", () => {
  it("% de cobertura = clientes ÷ total; total zero → null ('—')", () => {
    expect(percentualCobertura(0, 0)).toBeNull();
    expect(percentualCobertura(1, 3)).toBe(33.3);
    expect(percentualCobertura(3, 3)).toBe(100);
    expect(resumirLinhas([])).toEqual({ total: 0, clientes: 0, em_fechamento: 0, em_negociacao: 0, perdidos: 0, ex_clientes: 0, nao_abordados: 0, cobertura: null });
    expect(resumirLinhas([{ status: "cliente" }, { status: "nao_abordado" }, { status: "nao_abordado" }, { status: "ex_cliente" }])).toMatchObject({ total: 4, clientes: 1, nao_abordados: 2, ex_clientes: 1, cobertura: 25 });
  });
  it("textos", () => {
    expect(textoContagem(37)).toBe("37 prefeituras");
    expect(textoContagem(1)).toBe("1 prefeitura");
    expect(textoContagem(0)).toBe("Nenhuma prefeitura");
    expect(textoContagem(1234)).toBe("1.234 prefeituras");
    expect(textoClientesDaEntidade(3, 12)).toBe("3 de 12 prefeituras já são clientes da NEXAIGEN");
    expect(textoClientesDaEntidade(0, 12)).toBe("Nenhuma prefeitura desta entidade fechou ainda");
    expect(textoClientesNaEtiqueta(1)).toBe("1 prefeitura desta entidade já é cliente");
    expect(textoClientesNaEtiqueta(4)).toBe("4 prefeituras desta entidade já são clientes");
  });
});

describe("filtros na URL", () => {
  it("ida e volta: o que se monta é o que se lê (link compartilhável)", () => {
    const f = { ...FILTROS_VAZIOS, uf: "PR", planos: ["pequeno_porte" as const, "sem_plano" as const], ignorarSugerido: true, entidade: "6f1c2b0e-5a4d-4c3b-9e8f-1a2b3c4d5e6f", status: "nao_abordado" as const, etapa: "contato" as const, microrregiao: "Maringá", populacaoMin: 10_000, populacaoMax: 49_999, parado: true, acaoVencida: true, busca: "mar", ordenar: "populacao" as const, direcao: "desc" as const, pagina: 2 };
    const q = montarQueryTerritorio(f);
    expect(q).toBe("uf=PR&plano=pequeno_porte%2Csem_plano&ignorar_sugerido=1&entidade=6f1c2b0e-5a4d-4c3b-9e8f-1a2b3c4d5e6f&status=nao_abordado&etapa=contato&micro=Maring%C3%A1&pop_min=10000&pop_max=49999&parado=1&vencida=1&busca=mar&ordenar=populacao&direcao=desc&pagina=2");
    expect(lerFiltrosTerritorio(new URLSearchParams(q))).toEqual({ filtros: f, avisos: [] });
    expect(montarQueryTerritorio(FILTROS_VAZIOS)).toBe("");
  });

  it("valor inválido NUNCA quebra: é ignorado e vira aviso", () => {
    const r = lerFiltrosTerritorio({ uf: "ZZ", plano: "pequeno_porte,ouro", entidade: "abc", status: "vip", etapa: "ganho", pop_min: "dez", pagina: "-3" });
    expect(r.filtros).toEqual({ ...FILTROS_VAZIOS, planos: ["pequeno_porte"] });
    expect(r.avisos).toEqual(['UF "ZZ" ignorada.', 'Plano "ouro" ignorado.', "Entidade do filtro não encontrada — filtro ignorado.", 'Status "vip" ignorado.', 'Etapa "ganho" ignorada.', 'População mínima "dez" ignorada (use só números).', 'Página "-3" ignorada (use só números).']);
  });

  it("saneamento: estado não liberado, entidade removida, vendedor pra vendas e faixa invertida são ignorados com aviso", () => {
    const r = sanearFiltros(
      { ...FILTROS_VAZIOS, uf: "SC", entidade: "x", vendedor: "v", populacaoMin: 50, populacaoMax: 10 },
      { admin: false, ufsVisiveis: ["PR"], entidadeExiste: () => false }
    );
    expect(r.filtros).toEqual(FILTROS_VAZIOS);
    expect(r.avisos).toHaveLength(4);
    expect(r.avisos[0]).toBe("O estado SC não está liberado para o comercial — filtro de UF ignorado.");
  });
});

describe("filtrar, ordenar e lote", () => {
  const vendas = { equipeId: "beto", admin: false };
  const m = (codigo: string, nome: string, populacao: number | null) => ({ ...MARINGA, codigo_ibge: codigo, nome, populacao });
  const linhas: LinhaTerritorio[] = [
    montarLinha(m("4100001", "Alfa", 5_000), [], [], [], vendas, HOJE), // não abordado, dispensa sugerido
    montarLinha(m("4100002", "Beta", 30_000), [cliente({ codigo_ibge: "4100002", plano: "pequeno_porte" })], [], [{ id: "e1", nome: "Assoc", sigla: "A", clientes: 1 }], vendas, HOJE),
    montarLinha(m("4100003", "Gama", null), [], [lead({ codigo_ibge: "4100003", vendedor_id: "beto", plano_interesse: "medio_porte" })], [{ id: "e1", nome: "Assoc", sigla: "A", clientes: 1 }], vendas, HOJE),
    montarLinha(m("4100004", "Delta", 80_000), [], [lead({ codigo_ibge: "4100004" })], [], vendas, HOJE), // lead de COLEGA (parado/vencido escondidos)
    montarLinha(m("4100005", "Épsilon", 250_000), [], [PERDIDO].map((l) => ({ ...l, codigo_ibge: "4100005" })), [], vendas, HOJE)
  ];
  const nomes = (f: Partial<typeof FILTROS_VAZIOS>) => filtrarLinhas(linhas, { ...FILTROS_VAZIOS, ...f }).map((l) => l.nome);

  it("plano (múltiplo), sem plano, ignorar o sugerido", () => {
    expect(nomes({ planos: ["dispensa"] })).toEqual(["Alfa"]);
    expect(nomes({ planos: ["pequeno_porte", "medio_porte"] })).toEqual(["Beta", "Gama", "Delta"]);
    expect(nomes({ planos: ["sem_plano"] })).toEqual([]);
    expect(nomes({ ignorarSugerido: true })).toEqual(["Beta", "Gama"]); // só contratado / de interesse
    expect(nomes({ ignorarSugerido: true, planos: ["sem_plano"] })).toEqual(["Alfa", "Delta", "Épsilon"]);
    expect(casaPlano({ id: null, origem: "sem_plano" }, ["sem_plano"], false)).toBe(true);
  });

  it("todos os filtros combinam (AND); parado/vencida nunca casam lead de colega", () => {
    expect(nomes({ status: "em_negociacao" })).toEqual(["Gama", "Delta"]);
    expect(nomes({ entidade: "e1", status: "cliente" })).toEqual(["Beta"]);
    expect(nomes({ parado: true })).toEqual(["Gama"]);
    expect(nomes({ acaoVencida: true, etapa: "proposta" })).toEqual(["Gama"]);
    expect(nomes({ populacaoMin: 10_000, populacaoMax: 100_000 })).toEqual(["Beta", "Delta"]);
    expect(nomes({ busca: "EPSI" })).toEqual(["Épsilon"]);
    expect(nomes({ busca: "4100002" })).toEqual(["Beta"]);
  });

  it("ordenação: população/plano sem valor SEMPRE no fim; status na ordem da legenda; empate por nome", () => {
    expect(ordenarLinhas(linhas, "populacao", "desc").map((l) => l.nome)).toEqual(["Épsilon", "Delta", "Beta", "Alfa", "Gama"]);
    expect(ordenarLinhas(linhas, "populacao", "asc").map((l) => l.nome)).toEqual(["Alfa", "Beta", "Delta", "Épsilon", "Gama"]);
    expect(ordenarLinhas(linhas, "status", "asc").map((l) => l.status)).toEqual(["cliente", "em_negociacao", "em_negociacao", "perdido", "nao_abordado"]);
    expect(ordenarLinhas(linhas, "nome", "asc").map((l) => l.nome)).toEqual(["Alfa", "Beta", "Delta", "Épsilon", "Gama"]);
  });

  it("lote: cliente vigente e lead aberto são pulados com o motivo; 'não abordadas' pula também perdido e ex-cliente", () => {
    expect(linhas.map((l) => motivoParaPular(l, "selecao"))).toEqual([null, "já é cliente (contrato ativo)", "já tem lead aberto com Vera Vendas — etapa Proposta", "já tem lead aberto com Vera Vendas — etapa Proposta", null]);
    expect(motivoParaPular(linhas[4], "nao_abordados")).toMatch(/lead perdido/);
    const ex = montarLinha(m("4100006", "Zeta", 1), [cliente({ codigo_ibge: "4100006", status_contrato: "encerrado" })], [], [], vendas, HOJE);
    expect(motivoParaPular(ex, "selecao")).toBeNull();
    expect(motivoParaPular(ex, "nao_abordados")).toMatch(/^ex-cliente/);
  });
});
