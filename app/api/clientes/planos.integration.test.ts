// Planos por porte (rodada 11-A) pelas ROTAS REAIS contra Postgres real:
// criação em cada plano (padrões e valores editados), PATCH sem plano não
// regrava padrão, integração com o Educa (4 planos, recusa 'essencial',
// reenvio), nota de implantação (1 vez, 409 na segunda, Dispensa recusada),
// MRR sem implantação e Dashboard = Painel com nota de implantação na base.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));

import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { gerarAccessToken, NOME_COOKIE_ACCESS } from "@/lib/auth";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { obterResumoDashboard } from "@/lib/resumoDashboard";
import { chaveLimite } from "@/lib/rateLimit";
import { POST as CRIAR_CLIENTE } from "@/app/api/clientes/route";
import { PATCH as EDITAR_CLIENTE } from "@/app/api/clientes/[id]/route";
import { POST as CRIAR_NOTA } from "@/app/api/notas/route";
import { POST as INTEGRACAO } from "@/app/api/integracao/clientes/route";
import { GET as PAINEL } from "@/app/api/painel-financeiro/route";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const HOJE = hojeEmSaoPaulo(new Date());
const SEGREDO = "segredo-teste-planos";
const sufixo = randomUUID().slice(0, 8);
let cookie: string;
let equipeId: string;
const clientes: string[] = [];
const ipsUsados: string[] = [];

const req = (url: string, metodo: string, corpo?: unknown, extras: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3001${url}`, {
    method: metodo,
    headers: { "content-type": "application/json", cookie, ...extras },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });

async function criarCliente(corpo: Record<string, unknown>): Promise<{ status: number; id?: string; corpo: Record<string, unknown> }> {
  const res = await CRIAR_CLIENTE(req("/api/clientes", "POST", { nome: `Prefeitura Planos ${sufixo} ${clientes.length}`, uf: "PR", data_inicio_contrato: "2026-01-01", ...corpo }));
  const json = await res.json();
  if (json.id) clientes.push(json.id);
  return { status: res.status, id: json.id, corpo: json };
}

const linha = async (id: string) =>
  (await query<{ plano: string; valor_mensal: string; taxa_implantacao: string | null; observacao: string | null }>(
    `select plano, valor_mensal, taxa_implantacao, observacao from cliente_prefeitura where id = $1`,
    [id]
  ))[0];

function integracao(corpo: Record<string, unknown>) {
  const ip = `teste-planos-${randomUUID()}`;
  ipsUsados.push(ip);
  return INTEGRACAO(req("/api/integracao/clientes", "POST", corpo, { authorization: `Bearer ${SEGREDO}`, "x-forwarded-for": ip }));
}

beforeAll(async () => {
  process.env.INTEGRACAO_SECRET = SEGREDO;
  const [e] = await query<{ id: string; token_version: number }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria) values ('Pessoa Planos', $1, 'x', false) returning id, token_version`,
    [`planos-${sufixo}@teste.nexaigen.invalid`]
  );
  equipeId = e.id;
  cookie = `${NOME_COOKIE_ACCESS}=${await gerarAccessToken({ equipeId, nome: "Pessoa Planos", precisaTrocarSenha: false, tokenVersion: e.token_version })}`;
});

afterAll(async () => {
  await query(`delete from cliente_prefeitura where id = any($1::uuid[])`, [clientes]);
  await query(`delete from equipe_nexaigen where id = $1`, [equipeId]);
  const chaves = ipsUsados.flatMap((ip) => [chaveLimite("integracao:ip", ip), chaveLimite("integracao:falha-auth", ip)]);
  await query(`delete from rate_limit_contador where chave = any($1::text[])`, [chaves]);
});

describe("criação de cliente em cada plano — rota real", () => {
  it.each([
    ["dispensa", "5457.00", null],
    ["pequeno_porte", "8500.00", "15000.00"],
    ["medio_porte", "15000.00", "20000.00"],
    ["grande_porte", "35000.00", "30000.00"]
  ])("%s sem valores enviados → padrões do plano gravados", async (plano, mensal, taxa) => {
    const r = await criarCliente({ plano });
    expect(r.status).toBe(200);
    expect(await linha(r.id!)).toMatchObject({ plano, valor_mensal: mensal, taxa_implantacao: taxa });
  });

  it("valores EDITADOS (texto) valem como vieram — o servidor não força o padrão", async () => {
    const r = await criarCliente({ plano: "grande_porte", valor_mensal: "32000,00", taxa_implantacao: "25000" });
    expect(await linha(r.id!)).toMatchObject({ valor_mensal: "32000.00", taxa_implantacao: "25000.00" });
  });

  it("Dispensa com taxa → 400, nada gravado; plano descontinuado → 400 com mensagem clara", async () => {
    expect((await criarCliente({ plano: "dispensa", taxa_implantacao: "100" })).status).toBe(400);
    const antigo = await criarCliente({ plano: "essencial" });
    expect(antigo.status).toBe(400);
    expect(JSON.stringify(antigo.corpo)).toMatch(/descontinuado/);
  });
});

describe("PATCH — nunca regrava padrão sem pedido", () => {
  it("PATCH sem plano (só observação) mantém valor e taxa combinados", async () => {
    const { id } = await criarCliente({ plano: "grande_porte", valor_mensal: "32000", taxa_implantacao: "25000" });
    const res = await EDITAR_CLIENTE(req(`/api/clientes/${id}`, "PATCH", { observacao: "renegociado" }), { params: Promise.resolve({ id: id! }) });
    expect(res.status).toBe(200);
    expect(await linha(id!)).toEqual({ plano: "grande_porte", valor_mensal: "32000.00", taxa_implantacao: "25000.00", observacao: "renegociado" });
  });

  it("PATCH só de plano=dispensa num cliente com taxa → 400 explicando (CHECK do banco), nada muda; com taxa null → ok", async () => {
    const { id } = await criarCliente({ plano: "pequeno_porte" });
    const ctx = { params: Promise.resolve({ id: id! }) };
    const recusado = await EDITAR_CLIENTE(req(`/api/clientes/${id}`, "PATCH", { plano: "dispensa" }), ctx);
    expect(recusado.status).toBe(400);
    expect((await recusado.json()).detalhes.formErrors[0]).toMatch(/envie também taxa_implantacao: null/);
    expect((await linha(id!)).plano).toBe("pequeno_porte");

    const aceito = await EDITAR_CLIENTE(req(`/api/clientes/${id}`, "PATCH", { plano: "dispensa", valor_mensal: "5457,00", taxa_implantacao: null }), { params: Promise.resolve({ id: id! }) });
    expect(aceito.status).toBe(200);
    expect(await linha(id!)).toMatchObject({ plano: "dispensa", valor_mensal: "5457.00", taxa_implantacao: null });
  });
});

describe("integração com o Educa — rota real", () => {
  const corpo = (extra: Record<string, unknown>) => ({ municipioIdExterno: randomUUID(), nome: `Prefeitura Educa ${sufixo}`, uf: "MG", dataInicioContrato: "2026-02-01", ...extra });
  const guardar = async (res: Response) => {
    const j = await res.json();
    if (j.id) clientes.push(j.id);
    return j;
  };

  it.each([
    ["pequeno_porte", "8500.00", "15000.00"],
    ["medio_porte", "15000.00", "20000.00"],
    ["grande_porte", "35000.00", "30000.00"],
    ["dispensa", "5457.00", null]
  ])("aceita %s; sem valorMensal/taxa → padrões do plano no INSERT", async (plano, mensal, taxa) => {
    const res = await integracao(corpo({ plano }));
    expect(res.status).toBe(200);
    const { id } = await guardar(res);
    expect(await linha(id)).toMatchObject({ plano, valor_mensal: mensal, taxa_implantacao: taxa });
  });

  it("plano 'essencial' (Educa desatualizado) → 400, nada gravado", async () => {
    const c = corpo({ plano: "essencial", valorMensal: 4500 });
    const res = await integracao(c);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/plano \\"essencial\\" foi descontinuado/);
    expect(await query(`select 1 from cliente_prefeitura where municipio_id_externo = $1`, [c.municipioIdExterno])).toHaveLength(0);
  });

  it("reenvio: sem valorMensal mantém o valor editado à mão; COM valorMensal sobrescreve (comportamento de sempre); trocar pra Dispensa zera a taxa", async () => {
    const c = corpo({ plano: "medio_porte", valorMensal: 15000 });
    const { id } = await guardar(await integracao(c));
    await EDITAR_CLIENTE(req(`/api/clientes/${id}`, "PATCH", { valor_mensal: "14000", taxa_implantacao: "18000" }), { params: Promise.resolve({ id }) });

    expect((await (await integracao({ ...c, valorMensal: undefined })).json()).criado).toBe(false);
    expect(await linha(id)).toMatchObject({ valor_mensal: "14000.00", taxa_implantacao: "18000.00" });

    await integracao({ ...c, valorMensal: "15500,00" });
    expect((await linha(id)).valor_mensal).toBe("15500.00");

    await integracao({ ...c, plano: "dispensa", valorMensal: undefined });
    expect(await linha(id)).toMatchObject({ plano: "dispensa", taxa_implantacao: null });

    // Taxa enviada sem plano pra um cliente que é Dispensa → 400 (CHECK do banco), nada muda.
    const recusado = await integracao({ ...c, plano: undefined, valorMensal: undefined, taxaImplantacao: "100" });
    expect(recusado.status).toBe(400);
    expect((await linha(id)).taxa_implantacao).toBeNull();
  });
});

describe("nota de implantação — rota real", () => {
  const criarNota = (corpo: Record<string, unknown>) => CRIAR_NOTA(req("/api/notas", "POST", { valor: "15000", data_emissao: HOJE, ...corpo }));

  it("1ª vez → 201 (competência = mês da emissão); 2ª → 409; cancelada libera de novo", async () => {
    const { id } = await criarCliente({ plano: "pequeno_porte" });
    const primeira = await criarNota({ cliente_id: id, tipo: "implantacao", numero_nf: `IMP-${sufixo}` });
    expect(primeira.status).toBe(201);
    const { id: notaId } = await primeira.json();
    const [nota] = await query<{ tipo: string; competencia: string }>(`select tipo, competencia from nota_fiscal where id = $1`, [notaId]);
    expect(nota).toEqual({ tipo: "implantacao", competencia: `${HOJE.slice(0, 7)}-01` });

    const segunda = await criarNota({ cliente_id: id, tipo: "implantacao" });
    expect(segunda.status).toBe(409);
    expect((await segunda.json()).erro).toMatch(/já tem uma nota de implantação ativa/);

    await query(`update nota_fiscal set status = 'cancelada' where id = $1`, [notaId]);
    expect((await criarNota({ cliente_id: id, tipo: "implantacao" })).status).toBe(201);
  });

  it("cliente Dispensa (sem taxa) → 409; implantação concorrente 2× ao mesmo tempo → uma 201, outra 409", async () => {
    const { id: dispensa } = await criarCliente({ plano: "dispensa" });
    expect((await criarNota({ cliente_id: dispensa, tipo: "implantacao" })).status).toBe(409);

    const { id: porte } = await criarCliente({ plano: "grande_porte" });
    const [a, b] = await Promise.all([criarNota({ cliente_id: porte, tipo: "implantacao" }), criarNota({ cliente_id: porte, tipo: "implantacao" })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });
});

describe("Painel e Dashboard com implantação — mesmos números, MRR sem implantação", () => {
  it("nota de implantação muda 'a receber' mas NÃO o MRR; 'a cobrar' some quando a nota é emitida; Dashboard = Painel", async () => {
    const painelAgora = async () => (await PAINEL(req("/api/painel-financeiro", "GET"))).json();
    const { id } = await criarCliente({ plano: "medio_porte", valor_mensal: "15000", taxa_implantacao: "20000" });

    const antes = await painelAgora();
    const linhaAntes = antes.clientes.find((c: { id: string }) => c.id === id);
    expect(linhaAntes).toMatchObject({ planoRotulo: "Médio Porte", implantacaoACobrarCentavos: 2000000 });
    const resumoAntes = await obterResumoDashboard();
    expect(resumoAntes.implantacaoACobrar).toEqual(antes.kpis.implantacao.aCobrar);

    expect((await CRIAR_NOTA(req("/api/notas", "POST", { cliente_id: id, tipo: "implantacao", valor: "20000", data_emissao: HOJE }))).status).toBe(201);

    const depois = await painelAgora();
    expect(depois.kpis.mrr.valorCentavos).toBe(antes.kpis.mrr.valorCentavos); // implantação NÃO entra no MRR
    expect(depois.kpis.implantacao.aReceberCentavos - antes.kpis.implantacao.aReceberCentavos).toBe(2000000);
    expect(depois.kpis.implantacao.aCobrar.centavos).toBe(antes.kpis.implantacao.aCobrar.centavos - 2000000);
    expect((depois.kpis.aReceber?.totalCentavos ?? 0) - (antes.kpis.aReceber?.totalCentavos ?? 0)).toBe(2000000);
    expect(depois.clientes.find((c: { id: string }) => c.id === id).implantacaoACobrarCentavos).toBeNull();

    const resumo = await obterResumoDashboard();
    expect(resumo.emAbertoCentavos).toBe(depois.kpis.aReceber?.totalCentavos ?? null);
    expect(resumo.contagemPorSituacao).toEqual(depois.kpis.contagemPorSituacao);
    expect(resumo.implantacaoACobrar).toEqual(depois.kpis.implantacao.aCobrar);
  });
});
