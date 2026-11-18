// Base territorial (rodada 16-A2) com POSTGRES REAL, pelas rotas reais,
// num banco TEMPORÁRIO (testes/bancoTemporario.ts — o lote grava histórico
// somente-acréscimo que não pode ser apagado depois; o banco de
// desenvolvimento nunca é tocado). Cobre:
//   - importar municípios (o arquivo REAL do PR) é idempotente;
//   - CSV de entidades: válido grava tudo; inválido não grava NADA;
//     reimportar não duplica;
//   - status e plano efetivo em todas as situações (cliente com e sem
//     código IBGE, ex-cliente, lead aberto, perdido, não abordado);
//   - contagens por entidade; município em duas entidades;
//   - vendas não vê campos do lead de colega (chaves EXATAS) nem pela
//     entidade; financeiro/rh → 403; estado não liberado some pra vendas;
//   - visão salva isolada por pessoa; filtro salvo com entidade removida
//     é ignorado com aviso;
//   - lote: cria só os elegíveis, pula duplicados/clientes, grava
//     histórico, é ATÔMICO (falha no meio → nada fica);
//   - exportação com os mesmos números da tela; colunas exatas;
//   - filtro de plano da lista de leads (SQL) igual à regra em TS nas bordas.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { bancoLocal, criarBancoTemporario, type BancoTemporario } from "@/testes/bancoTemporario";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const LOCAL = bancoLocal();
let banco: BancoTemporario | null = null;
if (LOCAL) {
  banco = await criarBancoTemporario("territorio");
  process.env.DATABASE_URL = banco.url; // ANTES de qualquer import de lib/db
}

const { query } = await import("./db");
const { gerarAccessToken, NOME_COOKIE_ACCESS } = await import("./auth");
const { validarBaseMunicipios } = await import("./baseMunicipios");
const { importarMunicipios } = await import("./municipiosImportacao");
const { validarCsvEntidades } = await import("./entidadesCsv");
const { codigosNaBase, importarEntidadesCsv, liberarEstado } = await import("./entidadesServico");
const { COLUNAS_CSV_ENTIDADES } = await import("./entidadesCsv");
const { planoSugeridoPorPopulacao } = await import("./planos");
const { COLUNAS_EXPORTACAO_TERRITORIO } = await import("./territorioExportacao");
const rotaTerritorio = await import("@/app/api/territorio/route");
const rotaExportar = await import("@/app/api/territorio/exportar/route");
const rotaLote = await import("@/app/api/territorio/leads/route");
const rotaEntidades = await import("@/app/api/entidades/route");
const rotaEntidade = await import("@/app/api/entidades/[id]/route");
const rotaMunicipios = await import("@/app/api/municipios/route");
const rotaVisoes = await import("@/app/api/crm/visoes/route");
const rotaVisao = await import("@/app/api/crm/visoes/[id]/route");
const rotaLeads = await import("@/app/api/leads/route");
const rotaBusca = await import("@/app/api/crm/busca/route");
const repo = await import("./territorioRepositorio");

const TEMPO = 60_000;
const C = { curitiba: "4106902", londrina: "4113700", maringa: "4115200", cascavel: "4104808", pontaGrossa: "4119905", abatia: "4100103", toledo: "4127700", adrianopolis: "4100202", agudos: "4100301", tamandare: "4100400" };

const pessoas: Record<"admin" | "vera" | "beto" | "financeiro" | "rh", { id: string; cookie: string }> = {} as never;
let primeiraImportacao: { inseridos: number; atualizados: number; inalterados: number; totalDaUf: number };
const entidades: Record<"norte" | "sul", string> = {} as never;

async function pessoa(papel: string, nome: string) {
  const [e] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria, papel) values ($1, $2, 'x', false, $3) returning id, token_version`,
    [nome, `${papel}-${randomUUID().slice(0, 6)}@teste.invalid`, papel]
  );
  return { id: e.id, cookie: `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId: e.id, nome, precisaTrocarSenha: false, tokenVersion: e.token_version })}` };
}

const pedir = (url: string, cookie: string, metodo = "GET", corpo?: unknown) =>
  new NextRequest(`http://localhost:3001${url}`, { method: metodo, headers: { cookie, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

type Linha = { codigo_ibge: string; nome: string; status: string; lead: Record<string, unknown> | null; plano: { id: string | null; origem: string; divergente: boolean }; contrato: unknown; cliente_sem_codigo: boolean; ex_cliente_encerrado_em: string | null; entidades: { id: string; clientes: number }[] };
async function territorio(cookie: string, q: string): Promise<{ total: number; linhas: Linha[]; resumo: Record<string, number | null>; avisos: string[]; uf: string | null }> {
  const res = await rotaTerritorio.GET(pedir(`/api/territorio?${q}`, cookie));
  expect(res.status).toBe(200);
  return res.json();
}

const csvEntidades = (linhas: Record<string, string>[]) =>
  [COLUNAS_CSV_ENTIDADES.join(";"), ...linhas.map((l) => COLUNAS_CSV_ENTIDADES.map((c) => l[c] ?? "").join(";"))].join("\n");
const entidadeCsv = (nome: string, sigla: string, codigo: string, extra: Record<string, string> = {}) => ({
  entidade_nome: nome, sigla, tipo: "associacao_municipios", uf: "PR", fonte_url: "https://fonte.invalid/x", verificado_em: "2026-06-01", contato_email: "contato@entidade.invalid", codigo_ibge_membro: codigo, ...extra
});
async function importarCsv(conteudo: string) {
  const codigos = conteudo.split("\n").slice(1).map((l) => l.split(";").at(-1)!.trim()).filter(Boolean);
  const v = validarCsvEntidades(conteudo, await codigosNaBase(codigos), "2026-11-18");
  return v.ok ? { ok: true as const, resultado: await importarEntidadesCsv(v.entidades) } : v;
}

describe.skipIf(!LOCAL)("Território — Postgres real (banco temporário)", () => {
  beforeAll(async () => {
    const [{ atual }] = await query<{ atual: string }>(`select current_database() as atual`);
    if (atual !== banco!.nome) throw new Error(`Fora do banco temporário (${atual}) — abortado antes de gravar.`);
    pessoas.admin = await pessoa("admin", "Ana Admin");
    pessoas.vera = await pessoa("vendas", "Vera Vendas");
    pessoas.beto = await pessoa("vendas", "Beto Vendas");
    pessoas.financeiro = await pessoa("financeiro", "Fábio Financeiro");
    pessoas.rh = await pessoa("rh", "Rita RH");

    const pr = validarBaseMunicipios(JSON.parse(readFileSync("scripts/dados/municipios-PR.json", "utf-8")), "PR");
    if (!pr.ok) throw new Error(pr.erros.join("\n"));
    primeiraImportacao = await importarMunicipios("PR", pr.municipios);
    // Um estado NÃO liberado (SC), com dois municípios.
    await importarMunicipios("SC", [
      { codigo_ibge: "4205407", nome: "Florianópolis", nome_busca: "florianopolis", uf: "SC", populacao: 550_000, populacao_ano: 2026, microrregiao: null, mesorregiao: null },
      { codigo_ibge: "4209102", nome: "Joinville", nome_busca: "joinville", uf: "SC", populacao: 650_000, populacao_ano: 2026, microrregiao: null, mesorregiao: null }
    ]);
    await liberarEstado("PR", true, pessoas.admin.id);
    await liberarEstado("SC", false, pessoas.admin.id);

    // Clientes: Curitiba ativo COM código (plano diferente do sugerido); Londrina ativo SEM código; Maringá encerrado (ex-cliente).
    await query(`insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, codigo_ibge, plano) values ('Prefeitura Municipal de Curitiba', 'PR', 1000, '2026-02-01', $1, 'medio_porte')`, [C.curitiba]);
    await query(`insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, plano) values ('Prefeitura Municipal de Londrina', 'PR', 1000, '2025-05-01', 'grande_porte')`);
    const [{ id: maringa }] = await query<{ id: string }>(
      `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, codigo_ibge, status_contrato, cancelamento_pedido_em, cancelamento_termino_em)
       values ('Prefeitura de Maringá', 'PR', 1000, '2025-01-01', $1, 'encerrado', '2026-03-01', '2026-03-31') returning id`,
      [C.maringa]
    );
    await query(`insert into cliente_evento_contrato (cliente_id, tipo, data_evento, origem) values ($1, 'contrato_encerrado', '2026-03-31', 'sistema')`, [maringa]);

    // Leads: Cascavel aberto (Vera, interesse Pequeno); Ponta Grossa perdido (Vera); Toledo aberto (BETO, com contato e plano — não pode vazar pra Vera).
    const inserirLead = (nome: string, codigo: string, vendedor: string, extra: string, valores: unknown[] = []) =>
      query(
        `insert into lead (municipio_nome, nome_busca, uf, codigo_ibge, origem, vendedor_id${extra ? `, ${extra}` : ""}) values ($1, $2, 'PR', $3, 'site', $4${valores.map((_, i) => `, $${i + 5}`).join("")})`,
        [nome, nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""), codigo, vendedor, ...valores]
      );
    await inserirLead("Cascavel", C.cascavel, pessoas.vera.id, "etapa, plano_interesse", ["proposta", "pequeno_porte"]);
    await inserirLead("Ponta Grossa", C.pontaGrossa, pessoas.vera.id, "etapa, motivo_perda", ["perdido", "preco"]);
    await inserirLead("Toledo", C.toledo, pessoas.beto.id, "etapa, plano_interesse, contato_email, contato_telefone, valor_mensal_estimado_centavos, proxima_acao_em", [
      "negociacao", "grande_porte", "segredo@toledo.invalid", "(45) 99999-0000", 3_500_000, "2026-01-01"
    ]);
  }, TEMPO);

  afterAll(async () => {
    await (globalThis as { __nexaigenFinPgPool?: { end: () => Promise<void> } }).__nexaigenFinPgPool?.end();
    await banco?.derrubar();
  });

  it("importar municípios é idempotente: 399 do PR na 1ª vez; na 2ª, nada muda; nunca apaga", async () => {
    expect(primeiraImportacao).toEqual({ inseridos: 399, atualizados: 0, inalterados: 0, totalDaUf: 399 });
    const pr = validarBaseMunicipios(JSON.parse(readFileSync("scripts/dados/municipios-PR.json", "utf-8")), "PR");
    if (!pr.ok) throw new Error("arquivo inválido");
    expect(await importarMunicipios("PR", pr.municipios)).toEqual({ inseridos: 0, atualizados: 0, inalterados: 399, totalDaUf: 399 });
    // Um campo mudado → só aquele é atualizado; um município fora do arquivo continua no banco.
    expect(await importarMunicipios("PR", pr.municipios.map((m) => (m.codigo_ibge === C.abatia ? { ...m, populacao: 7202 } : m)))).toMatchObject({ inseridos: 0, atualizados: 1 });
    expect(await importarMunicipios("PR", pr.municipios.slice(0, 10))).toMatchObject({ atualizados: 1, totalDaUf: 399 }); // volta a população original do Abatiá
    const [{ n }] = await query<{ n: number }>(`select count(*)::int as n from municipio_base where uf = 'PR' and codigo_ibge ~ '^[0-9]{7}$'`);
    expect(n).toBe(399);
  }, TEMPO);

  it("CSV de entidades: inválido não grava NADA; válido grava entidades e membros; reimportar não duplica", async () => {
    const invalido = await importarCsv(csvEntidades([entidadeCsv("Associação Teste Norte", "ATN", C.curitiba), entidadeCsv("Associação Teste Norte", "ATN", "4199998"), entidadeCsv("Consórcio Teste Sul", "CTS", C.maringa, { fonte_url: "" })]));
    expect(invalido).toMatchObject({ ok: false, erros: [{ linha: 3 }, { linha: 4 }] });
    expect((await query(`select 1 from entidade_intermunicipal`)).length).toBe(0);
    expect((await query(`select 1 from entidade_membro`)).length).toBe(0);

    const valido = csvEntidades([
      ...[C.curitiba, C.londrina, C.cascavel, C.abatia, C.toledo].map((c) => entidadeCsv("Associação Teste Norte", "ATN", c)),
      ...[C.curitiba, C.maringa, C.abatia].map((c) => entidadeCsv("Consórcio Teste Sul", "CTS", c, { tipo: "consorcio_intermunicipal" }))
    ]);
    expect(await importarCsv(valido)).toEqual({ ok: true, resultado: { entidadesCriadas: 2, entidadesAtualizadas: 0, entidadesSemMudanca: 0, membrosNovos: 8, membrosJaExistentes: 0 } });
    expect(await importarCsv(valido)).toEqual({ ok: true, resultado: { entidadesCriadas: 0, entidadesAtualizadas: 0, entidadesSemMudanca: 2, membrosNovos: 0, membrosJaExistentes: 8 } });
    const linhas = await query<{ id: string; sigla: string }>(`select id, sigla from entidade_intermunicipal order by sigla`);
    expect(linhas.map((l) => l.sigla)).toEqual(["ATN", "CTS"]);
    entidades.norte = linhas[0].id;
    entidades.sul = linhas[1].id;
  }, TEMPO);

  it("status e plano efetivo em todas as situações (admin vê tudo)", async () => {
    const r = await territorio(pessoas.admin.cookie, "uf=PR");
    expect(r.total).toBe(399);
    const por = new Map(r.linhas.concat((await territorio(pessoas.admin.cookie, "uf=PR&pagina=2")).linhas, (await territorio(pessoas.admin.cookie, "uf=PR&pagina=3")).linhas, (await territorio(pessoas.admin.cookie, "uf=PR&pagina=4")).linhas).map((l) => [l.codigo_ibge, l]));
    expect(por.size).toBe(399);
    expect(por.get(C.curitiba)).toMatchObject({ status: "cliente", contrato: { situacao: "ativo", plano: "medio_porte", desde: "2026-02-01" }, plano: { id: "medio_porte", origem: "contratado", divergente: true }, cliente_sem_codigo: false });
    expect(por.get(C.londrina)).toMatchObject({ status: "cliente", cliente_sem_codigo: true, plano: { id: "grande_porte", origem: "contratado", divergente: false } });
    expect(por.get(C.maringa)).toMatchObject({ status: "ex_cliente", ex_cliente_encerrado_em: "2026-03-31", contrato: null, plano: { id: "grande_porte", origem: "sugerido" } });
    expect(por.get(C.cascavel)).toMatchObject({ status: "em_negociacao", lead: { etapa: "proposta", vendedor_nome: "Vera Vendas" }, plano: { id: "pequeno_porte", origem: "interesse" } });
    expect(por.get(C.pontaGrossa)).toMatchObject({ status: "perdido", lead: { etapa: "perdido", motivo_perda: "preco" }, plano: { id: "grande_porte", origem: "sugerido" } });
    expect(por.get(C.abatia)).toMatchObject({ status: "nao_abordado", lead: null, plano: { id: "dispensa", origem: "sugerido" } });
    expect(por.get(C.toledo)).toMatchObject({ status: "em_negociacao", lead: { vendedor_nome: "Beto Vendas" }, plano: { id: "grande_porte", origem: "interesse" } });
    expect(r.resumo).toMatchObject({ total: 399, clientes: 2, em_negociacao: 2, perdidos: 1, ex_clientes: 1, nao_abordados: 393, cobertura: 0.5 });
  }, TEMPO);

  it("contagens por entidade batem; município em duas entidades leva as duas etiquetas com os clientes de cada uma", async () => {
    const res = await rotaEntidades.GET(pedir("/api/entidades", pessoas.admin.cookie));
    const { entidades: lista } = await res.json();
    expect(lista.map((e: Record<string, unknown>) => [e.sigla, e.municipios, e.clientes, e.em_negociacao, e.nao_abordados, e.percentual_clientes])).toEqual([
      ["ATN", 5, 2, 2, 1, 40],
      ["CTS", 3, 1, 0, 1, 33.3]
    ]);
    const curitiba = (await territorio(pessoas.admin.cookie, "uf=PR&busca=curitiba")).linhas.find((l) => l.codigo_ibge === C.curitiba)!;
    expect(curitiba.entidades.map((e) => [e.id, e.clientes])).toEqual([
      [entidades.norte, 2],
      [entidades.sul, 1]
    ]);
    const tela = await (await rotaEntidade.GET(pedir(`/api/entidades/${entidades.norte}`, pessoas.admin.cookie), ctx(entidades.norte))).json();
    expect(tela.membros).toEqual({ total: 5, clientes: 2 });
    expect(tela.ja_fecharam.map((j: { nome: string }) => j.nome).sort()).toEqual(["Curitiba", "Londrina"]);
    expect(await (await rotaEntidades.GET(pedir("/api/entidades?busca=cts", pessoas.admin.cookie))).json()).toMatchObject({ entidades: [{ sigla: "CTS" }] });
  }, TEMPO);

  it("vendas: lead de COLEGA aparece só com etapa e vendedor (chaves EXATAS) no Território E na entidade; nada de contato/valor/plano do colega", async () => {
    const CHAVES_LINHA = ["cliente_sem_codigo", "codigo_ibge", "contrato", "entidades", "ex_cliente_encerrado_em", "lead", "mesorregiao", "microrregiao", "nome", "plano", "populacao", "populacao_ano", "status", "uf"];
    const r = await territorio(pessoas.vera.cookie, "uf=PR&busca=toledo");
    const toledo = r.linhas.find((l) => l.codigo_ibge === C.toledo)!;
    expect(Object.keys(toledo).sort()).toEqual(CHAVES_LINHA);
    expect(Object.keys(toledo.lead!).sort()).toEqual(["etapa", "vendedor_nome"]);
    expect(toledo.plano.origem).toBe("sugerido"); // o plano de interesse do colega não vaza nem pela origem

    const tela = await (await rotaEntidade.GET(pedir(`/api/entidades/${entidades.norte}`, pessoas.vera.cookie), ctx(entidades.norte))).json();
    const membro = tela.linhas.find((l: Linha) => l.codigo_ibge === C.toledo);
    expect(Object.keys(membro).sort()).toEqual(CHAVES_LINHA);
    expect(Object.keys(membro.lead).sort()).toEqual(["etapa", "vendedor_nome"]);
    for (const corpo of [JSON.stringify(r), JSON.stringify(tela)]) {
      for (const segredo of ["segredo@toledo.invalid", "99999-0000", "3500000", "2026-01-01"]) expect(corpo).not.toContain(segredo);
    }
    // O PRÓPRIO lead da Vera vem completo (id e selos).
    const cascavel = (await territorio(pessoas.vera.cookie, "uf=PR&busca=cascavel")).linhas[0];
    expect(Object.keys(cascavel.lead!).sort()).toEqual(["acao_vencida", "etapa", "id", "meu", "motivo_perda", "parado", "perdido_em", "vendedor_id", "vendedor_nome"]);
  }, TEMPO);

  it("financeiro e rh → 403 em tudo do Território; vendas → 403 na exportação e no cadastro de entidade", async () => {
    for (const p of [pessoas.financeiro, pessoas.rh]) {
      expect((await rotaTerritorio.GET(pedir("/api/territorio?uf=PR", p.cookie))).status).toBe(403);
      expect((await rotaEntidades.GET(pedir("/api/entidades", p.cookie))).status).toBe(403);
      expect((await rotaExportar.GET(pedir("/api/territorio/exportar?formato=csv", p.cookie))).status).toBe(403);
      expect((await rotaLote.POST(pedir("/api/territorio/leads", p.cookie, "POST", { acao: "previa", alvo: { modo: "selecao", codigos: [C.abatia] } }))).status).toBe(403);
    }
    expect((await rotaExportar.GET(pedir("/api/territorio/exportar?formato=csv", pessoas.vera.cookie))).status).toBe(403);
    expect((await rotaEntidades.POST(pedir("/api/entidades", pessoas.vera.cookie, "POST", {}))).status).toBe(403);
  }, TEMPO);

  it("estado NÃO liberado não aparece pra vendas (nem no Território, nem na busca); admin vê", async () => {
    const vendas = await territorio(pessoas.vera.cookie, "uf=SC");
    expect(vendas.uf).toBe("PR");
    expect(vendas.avisos).toContain("O estado SC não está liberado para o comercial — filtro de UF ignorado.");
    const admin = await territorio(pessoas.admin.cookie, "uf=SC");
    expect([admin.uf, admin.total]).toEqual(["SC", 2]);
    const busca = (cookie: string) => rotaMunicipios.GET(pedir("/api/municipios?busca=joinville", cookie)).then((r) => r.json());
    expect((await busca(pessoas.vera.cookie)).municipios).toEqual([]);
    expect((await busca(pessoas.admin.cookie)).municipios).toEqual([{ codigo_ibge: "4209102", nome: "Joinville", uf: "SC" }]);
  }, TEMPO);

  it("visão salva: cada pessoa vê só as suas; excluir a de outra pessoa → 404; filtro com entidade desativada é ignorado com aviso", async () => {
    const salvar = (cookie: string, nome: string, filtros: Record<string, string>) => rotaVisoes.POST(pedir("/api/crm/visoes", cookie, "POST", { nome, tela: "territorio", filtros }));
    const r = await salvar(pessoas.vera.cookie, "Pequeno porte no CTS", { uf: "PR", plano: "pequeno_porte", entidade: entidades.sul });
    expect(r.status).toBe(201);
    const { id } = await r.json();
    expect((await salvar(pessoas.vera.cookie, "Pequeno porte no CTS", {})).status).toBe(409);
    const listar = (cookie: string) => rotaVisoes.GET(pedir("/api/crm/visoes?tela=territorio", cookie)).then((x) => x.json());
    expect((await listar(pessoas.vera.cookie)).visoes.map((v: { nome: string }) => v.nome)).toEqual(["Pequeno porte no CTS"]);
    expect((await listar(pessoas.beto.cookie)).visoes).toEqual([]);
    expect((await rotaVisao.DELETE(pedir(`/api/crm/visoes/${id}`, pessoas.beto.cookie, "DELETE"), ctx(id))).status).toBe(404);
    expect((await listar(pessoas.vera.cookie)).visoes).toHaveLength(1);

    await rotaEntidade.PATCH(pedir(`/api/entidades/${entidades.sul}`, pessoas.admin.cookie, "PATCH", { ativo: false }), ctx(entidades.sul));
    const aberta = await territorio(pessoas.vera.cookie, `uf=PR&plano=pequeno_porte&entidade=${entidades.sul}`);
    expect(aberta.avisos).toEqual(["A entidade deste filtro não existe mais (ou foi desativada) — filtro ignorado."]);
    expect(aberta.total).toBeGreaterThan(0);
    expect((await rotaEntidade.GET(pedir(`/api/entidades/${entidades.sul}`, pessoas.vera.cookie), ctx(entidades.sul))).status).toBe(404); // desativada some pra vendas
    await rotaEntidade.PATCH(pedir(`/api/entidades/${entidades.sul}`, pessoas.admin.cookie, "PATCH", { ativo: true }), ctx(entidades.sul));
    expect((await rotaVisao.DELETE(pedir(`/api/crm/visoes/${id}`, pessoas.vera.cookie, "DELETE"), ctx(id))).status).toBe(200);
  }, TEMPO);

  it("lote por SELEÇÃO: prévia sem gravar; cria só os elegíveis (pula cliente e lead aberto), atribui a quem pediu e grava histórico", async () => {
    const alvo = { modo: "selecao", codigos: [C.pontaGrossa, C.curitiba, C.cascavel, C.adrianopolis] };
    const previa = await (await rotaLote.POST(pedir("/api/territorio/leads", pessoas.vera.cookie, "POST", { acao: "previa", alvo }))).json();
    expect(previa.criar.map((i: { nome: string }) => i.nome)).toEqual(["Adrianópolis", "Ponta Grossa"]);
    expect(previa.pulados.map((p: { nome: string; motivo: string }) => [p.nome, p.motivo])).toEqual([
      ["Cascavel", "já tem lead aberto com Vera Vendas — etapa Proposta"],
      ["Curitiba", "já é cliente (contrato ativo)"]
    ]);
    expect((await query(`select 1 from lead where codigo_ibge = $1`, [C.adrianopolis])).length).toBe(0); // prévia não grava

    expect((await rotaLote.POST(pedir("/api/territorio/leads", pessoas.vera.cookie, "POST", { acao: "criar", alvo, vendedor_id: pessoas.beto.id }))).status).toBe(403);
    const res = await rotaLote.POST(pedir("/api/territorio/leads", pessoas.vera.cookie, "POST", { acao: "criar", alvo }));
    expect(res.status).toBe(201);
    const { criados, pulados } = await res.json();
    expect(criados.map((c: { nome: string }) => c.nome)).toEqual(["Adrianópolis", "Ponta Grossa"]);
    expect(pulados).toHaveLength(2);
    const gravados = await query<{ vendedor_id: string; etapa: string; tipo: string; texto: string }>(
      `select l.vendedor_id, l.etapa, i.tipo, i.texto from lead l join lead_interacao i on i.lead_id = l.id where l.id = any($1::uuid[]) order by l.municipio_nome`,
      [criados.map((c: { lead_id: string }) => c.lead_id)]
    );
    expect(gravados).toEqual([
      { vendedor_id: pessoas.vera.id, etapa: "novo", tipo: "criacao", texto: "Lead aberto pelo Território (seleção de 4 prefeituras)." },
      { vendedor_id: pessoas.vera.id, etapa: "novo", tipo: "criacao", texto: "Lead aberto pelo Território (seleção de 4 prefeituras)." }
    ]);
    expect((await territorio(pessoas.vera.cookie, "uf=PR&busca=ponta grossa")).linhas[0].status).toBe("em_negociacao");
  }, TEMPO);

  it("lote da ENTIDADE ('todas as ainda não abordadas'): admin escolhe o vendedor; cliente e ex-cliente pulados", async () => {
    const alvo = { modo: "nao_abordados", filtros: {}, entidade_id: entidades.sul };
    const previa = await (await rotaLote.POST(pedir("/api/territorio/leads", pessoas.admin.cookie, "POST", { acao: "previa", alvo }))).json();
    expect(previa.criar.map((i: { nome: string }) => i.nome)).toEqual(["Abatiá"]);
    expect(previa.pulados.map((p: { nome: string }) => p.nome).sort()).toEqual(["Curitiba", "Maringá"]);
    const { criados } = await (await rotaLote.POST(pedir("/api/territorio/leads", pessoas.admin.cookie, "POST", { acao: "criar", alvo, vendedor_id: pessoas.beto.id }))).json();
    const [lead] = await query<{ vendedor_id: string; texto: string }>(`select l.vendedor_id, i.texto from lead l join lead_interacao i on i.lead_id = l.id where l.id = $1`, [criados[0].lead_id]);
    expect(lead).toEqual({ vendedor_id: pessoas.beto.id, texto: 'Lead aberto pela entidade Consórcio Teste Sul ("todas as prefeituras ainda não abordadas").' });
    // Repetir: nada mais a criar → 409 com explicação.
    expect((await rotaLote.POST(pedir("/api/territorio/leads", pessoas.admin.cookie, "POST", { acao: "criar", alvo }))).status).toBe(409);
  }, TEMPO);

  it("lote é ATÔMICO: falha no meio (simulada por trigger no banco temporário) → nenhum lead e nenhum histórico ficam", async () => {
    await query(`create function falha_no_lote() returns trigger language plpgsql as $$ begin if new.codigo_ibge = '${C.agudos}' then raise exception 'falha simulada no meio do lote'; end if; return new; end $$`);
    await query(`create trigger falha_no_lote before insert on lead for each row execute function falha_no_lote()`);
    const [{ antes }] = await query<{ antes: number }>(`select count(*)::int as antes from lead_interacao`);
    try {
      // Almirante Tamandaré (4100400) é gravado ANTES de Agudos do Sul (ordem alfabética) — e precisa sumir junto.
      const alvo = { modo: "selecao", codigos: [C.tamandare, C.agudos] };
      await expect(rotaLote.POST(pedir("/api/territorio/leads", pessoas.admin.cookie, "POST", { acao: "criar", alvo }))).rejects.toThrow(/falha simulada/);
    } finally {
      await query(`drop trigger falha_no_lote on lead`);
      await query(`drop function falha_no_lote()`);
    }
    expect((await query(`select 1 from lead where codigo_ibge = any($1::text[])`, [[C.tamandare, C.agudos]])).length).toBe(0);
    const [{ depois }] = await query<{ depois: number }>(`select count(*)::int as depois from lead_interacao`);
    expect(depois).toBe(antes);
  }, TEMPO);

  it("exportação: colunas exatas, mesmos números da tela (contagem e status), filtros no cabeçalho", async () => {
    const q = "uf=PR&plano=grande_porte,medio_porte";
    const tela = await territorio(pessoas.admin.cookie, q);
    const csv = await (await rotaExportar.GET(pedir(`/api/territorio/exportar?${q}&formato=csv`, pessoas.admin.cookie))).text();
    const linhas = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(linhas[0]).toBe("NEXAIGEN — Território comercial");
    expect(linhas[1]).toBe("Filtros: UF PR · plano Médio Porte, Grande Porte");
    expect(linhas[3]).toBe(`Prefeituras: ${tela.total}`);
    expect(linhas[5].split(";")).toEqual([...COLUNAS_EXPORTACAO_TERRITORIO]);
    const dados = linhas.slice(6).map((l) => l.split(";"));
    expect(dados).toHaveLength(tela.total);
    expect(dados.filter((d) => d[6].startsWith("Cliente")).length).toBe(tela.resumo.clientes);
    expect(dados.filter((d) => d[6].startsWith("Em negociação")).length).toBe(tela.resumo.em_negociacao);
    expect(csv).not.toContain("segredo@toledo.invalid");
    const toledo = dados.find((d) => d[2] === C.toledo)!;
    expect(toledo).toEqual(["Toledo", "PR", C.toledo, "162658", "Grande Porte", "de interesse", "Em negociação — Negociação", "Negociação", "Beto Vendas", "Associação Teste Norte (ATN)"]);
    // Da entidade: mesmo total da tela da entidade.
    const telaEntidade = await (await rotaEntidade.GET(pedir(`/api/entidades/${entidades.norte}`, pessoas.admin.cookie), ctx(entidades.norte))).json();
    const csvEntidade = await (await rotaExportar.GET(pedir(`/api/territorio/exportar?entidade_tela=${entidades.norte}&formato=xlsx`, pessoas.admin.cookie))).arrayBuffer();
    expect(csvEntidade.byteLength).toBeGreaterThan(0);
    const csvEnt = await (await rotaExportar.GET(pedir(`/api/territorio/exportar?entidade_tela=${entidades.norte}&formato=csv`, pessoas.admin.cookie))).text();
    expect(csvEnt.replace(/^﻿/, "").trimEnd().split("\r\n").slice(6)).toHaveLength(telaEntidade.total);
  }, TEMPO);

  it("lista de leads: filtro de plano no SQL = regra em TS nas bordas das faixas (população do lead ou da base); entidade filtra", async () => {
    const bordas = [9_999, 10_000, 49_999, 50_000, 199_999, 200_000];
    for (const [i, populacao] of bordas.entries()) {
      await query(`insert into lead (municipio_nome, nome_busca, uf, origem, vendedor_id, populacao) values ($1, $2, 'MS', 'site', $3, $4)`, [`Borda ${i}`, `borda ${i}`, pessoas.admin.id, populacao]);
    }
    await query(`insert into lead (municipio_nome, nome_busca, uf, origem, vendedor_id) values ('Borda sem população', 'borda sem populacao', 'MS', 'site', $1)`, [pessoas.admin.id]);
    const listar = async (q: string) => (await (await rotaLeads.GET(pedir(`/api/leads?uf=MS&por_pagina=100&${q}`, pessoas.admin.cookie))).json()) as { leads: { municipio_nome: string; populacao: number | null; plano_efetivo: { id: string | null; origem: string } }[] };
    for (const plano of ["dispensa", "pequeno_porte", "medio_porte", "grande_porte"]) {
      const { leads } = await listar(`plano=${plano}`);
      expect({ plano, populacoes: leads.map((l) => l.populacao).sort((a, b) => a! - b!) }).toEqual({ plano, populacoes: bordas.filter((p) => planoSugeridoPorPopulacao(p) === plano) });
      expect(leads.every((l) => l.plano_efetivo.id === plano && l.plano_efetivo.origem === "sugerido")).toBe(true);
    }
    expect((await listar("plano=sem_plano")).leads.map((l) => l.municipio_nome)).toEqual(["Borda sem população"]);
    expect((await listar("ignorar_sugerido=true")).leads).toEqual([]);
    // Sem população no lead: vale a da base (Cascavel 372.026 → Grande Porte sugerido; mas tem interesse Pequeno).
    const pr = await (await rotaLeads.GET(pedir(`/api/leads?uf=PR&plano=pequeno_porte&ignorar_sugerido=true`, pessoas.admin.cookie))).json();
    expect(pr.leads.map((l: { municipio_nome: string }) => l.municipio_nome)).toEqual(["Cascavel"]);
    const daEntidade = await (await rotaLeads.GET(pedir(`/api/leads?entidade=${entidades.norte}&ordenar=municipio&direcao=asc`, pessoas.admin.cookie))).json();
    expect(daEntidade.leads.map((l: { municipio_nome: string }) => l.municipio_nome)).toEqual(["Abatiá", "Cascavel", "Toledo"]); // Abatiá: lead do lote da entidade acima
  }, TEMPO);

  it("funções que só as PÁGINAS usam: opções de entidade, microrregiões, estados, busca global, etiquetas e entidades do lead", async () => {
    const admin = { equipeId: pessoas.admin.id, admin: true };
    const vera = { equipeId: pessoas.vera.id, admin: false };
    expect((await repo.opcoesDeEntidade(vera, "PR")).map((e) => e.sigla)).toEqual(["ATN", "CTS"]);
    expect((await repo.opcoesDeEntidade(vera, "SC")).map((e) => e.sigla)).toEqual([]);
    const micro = await repo.listarMicrorregioes("PR");
    expect(micro).toContain("Toledo");
    expect(micro).toEqual([...micro].sort());
    const estados = await repo.listarEstados();
    expect(estados).toHaveLength(27);
    expect(estados.find((e) => e.uf === "PR")).toMatchObject({ liberado: true, municipios: 399, liberado_por_nome: "Ana Admin" });
    expect(estados.find((e) => e.uf === "SC")).toMatchObject({ liberado: false, municipios: 2, liberado_em: null });
    expect(estados.find((e) => e.uf === "AM")).toMatchObject({ liberado: false, municipios: 0 });

    const busca = await (await rotaBusca.GET(pedir("/api/crm/busca?q=atn", pessoas.vera.cookie))).json();
    expect(busca.entidades.map((e: { sigla: string }) => e.sigla)).toEqual(["ATN"]);
    const buscaMunicipio = await (await rotaBusca.GET(pedir("/api/crm/busca?q=toledo", pessoas.vera.cookie))).json();
    expect(buscaMunicipio.municipios[0]).toEqual({ codigo_ibge: C.toledo, nome: "Toledo", uf: "PR" });
    expect((await (await rotaBusca.GET(pedir("/api/crm/busca?q=joinville", pessoas.vera.cookie))).json()).municipios).toEqual([]);

    // Lead SEM código: o município é achado pela base (UF + nome); etiquetas com a contagem de clientes.
    expect(await repo.codigoDoMunicipioDoLead({ codigo_ibge: null, uf: "PR", municipio_nome: "Prefeitura de TOLEDO" })).toBe(C.toledo);
    expect(await repo.codigoDoMunicipioDoLead({ codigo_ibge: null, uf: "PR", municipio_nome: "Não Existe" })).toBeNull();
    const etiquetas = await repo.etiquetasPorMunicipio([C.abatia], admin, "2026-11-18");
    expect(etiquetas.get(C.abatia)!.map((e) => [e.sigla, e.clientes])).toEqual([["ATN", 2], ["CTS", 1]]);
    const nomes = await repo.nomesDeEntidadesPorLead([{ id: randomUUID(), codigo_ibge: null, uf: "PR", municipio_nome: "Curitiba" }]);
    expect([...nomes.values()]).toEqual([["Associação Teste Norte (ATN)", "Consórcio Teste Sul (CTS)"]]);
  }, TEMPO);
});
