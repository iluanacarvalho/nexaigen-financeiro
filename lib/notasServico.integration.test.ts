// lib/notasServico.ts contra Postgres REAL: a situação em SQL (filtro e
// paginação no servidor) bate com lib/estadoNota.ts#situacaoDaNota (JS,
// usada pelo Painel/Dashboard) em todas as situações e bordas; filtros,
// busca, ordenação e paginação; criação (cliente inativo, número repetido);
// máquina de estados aplicada com lock (ações simultâneas na mesma nota).
// Cada cenário cria o próprio cliente; tudo apagado no fim.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { query } from "./db";
import { criarNota, executarAcaoNota, listarEventos, listarNotas, type FiltrosNotas } from "./notasServico";
import { situacaoDaNota, somarDias } from "./estadoNota";
import { hojeEmSaoPaulo } from "./painelFinanceiro";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const HOJE = hojeEmSaoPaulo(new Date());
const sufixo = randomUUID().slice(0, 8);
const clientes: string[] = [];
let equipeId: string;

async function criarCliente(status: "ativo" | "suspenso" | "encerrado" = "ativo"): Promise<string> {
  const [c] = await query<{ id: string }>(
    `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, status_contrato) values ($1, 'PR', 1000, '2026-01-01', $2) returning id`,
    [`Prefeitura Notas ${sufixo} ${clientes.length}`, status]
  );
  clientes.push(c.id);
  return c.id;
}

async function inserirNota(clienteId: string, n: { numero?: string; valor?: string; emissao?: string; atesto?: string | null; pagamento?: string | null; status?: string; competencia?: string }) {
  const [linha] = await query<{ id: string }>(
    `insert into nota_fiscal (cliente_id, competencia, numero_nf, valor, data_emissao, data_atesto, data_pagamento, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [clienteId, n.competencia ?? "2026-01-01", n.numero ?? null, n.valor ?? "100.00", n.emissao ?? "2026-01-02", n.atesto ?? null, n.pagamento ?? null, n.status ?? "aguardando_atesto"]
  );
  return linha.id;
}

const filtrosPadrao = (extra: Partial<FiltrosNotas> = {}): FiltrosNotas => ({ ordenar: "data_emissao", direcao: "desc", pagina: 1, porPagina: 100, ...extra });

beforeAll(async () => {
  const [e] = await query<{ id: string }>(
    `insert into equipe_nexaigen (nome, email, senha_hash, senha_temporaria) values ('Pessoa Notas', $1, 'x', false) returning id`,
    [`notas-${sufixo}@teste.nexaigen.invalid`]
  );
  equipeId = e.id;
});

afterAll(async () => {
  await query(`delete from cliente_prefeitura where id = any($1::uuid[])`, [clientes]);
  await query(`delete from equipe_nexaigen where id = $1`, [equipeId]);
});

describe("situação em SQL ≡ situação em JS (lib/estadoNota.ts) — todas as situações e bordas", () => {
  it("uma nota por caso; o filtro do servidor e a função pura dão a MESMA resposta", async () => {
    const cliente = await criarCliente();
    // Atesto há (30 + N) dias → N dias de atraso hoje (trigger: limite = atesto + 30).
    const atestoComAtraso = (dias: number) => somarDias(HOJE, -(30 + dias));
    const casos: [string, Parameters<typeof inserirNota>[1]][] = [
      ["sem atesto", { emissao: somarDias(HOJE, -3) }],
      ["sem atesto há 25 dias (atesto_atrasado → aguardando)", { emissao: somarDias(HOJE, -25) }],
      ["atestada, 10 dias pro limite", { emissao: somarDias(HOJE, -25), atesto: somarDias(HOJE, -20), status: "atestada" }],
      ["0 dias de atraso (vence hoje)", { emissao: somarDias(HOJE, -40), atesto: atestoComAtraso(0), status: "atestada" }],
      ["1 dia de atraso", { emissao: somarDias(HOJE, -40), atesto: atestoComAtraso(1), status: "atestada" }],
      ["59 dias de atraso", { emissao: somarDias(HOJE, -100), atesto: atestoComAtraso(59), status: "vencida" }],
      ["60 dias de atraso", { emissao: somarDias(HOJE, -100), atesto: atestoComAtraso(60), status: "vencida" }],
      ["paga", { emissao: somarDias(HOJE, -50), atesto: somarDias(HOJE, -45), pagamento: somarDias(HOJE, -10), status: "paga" }],
      ["cancelada", { emissao: somarDias(HOJE, -5), status: "cancelada" }],
      ["legado 'emitida' sem atesto", { emissao: somarDias(HOJE, -2), status: "emitida" }]
    ];
    const ids: Record<string, string> = {};
    for (const [nome, dados] of casos) ids[nome] = await inserirNota(cliente, dados);

    const { notas } = await listarNotas(filtrosPadrao({ clienteId: cliente }), HOJE);
    const linhas = await query<{ id: string; status: string; data_emissao: string; data_atesto: string | null; data_limite_pagamento: string | null; data_pagamento: string | null }>(
      `select id, status, data_emissao, data_atesto, data_limite_pagamento, data_pagamento from nota_fiscal where cliente_id = $1`,
      [cliente]
    );
    for (const linha of linhas) {
      expect(notas.find((n) => n.id === linha.id)!.situacao).toBe(situacaoDaNota(linha, HOJE));
    }

    const situacaoDe = (nome: string) => notas.find((n) => n.id === ids[nome])!.situacao;
    expect(situacaoDe("0 dias de atraso (vence hoje)")).toBe("atestada");
    expect(situacaoDe("1 dia de atraso")).toBe("vencida");
    expect(situacaoDe("59 dias de atraso")).toBe("vencida");
    expect(situacaoDe("60 dias de atraso")).toBe("atraso_critico");
    expect(situacaoDe("legado 'emitida' sem atesto")).toBe("aguardando_atesto");

    // E o FILTRO por situação devolve exatamente as que a função pura classifica assim.
    for (const situacao of ["aguardando_atesto", "atestada", "vencida", "atraso_critico", "paga", "cancelada"] as const) {
      const filtradas = await listarNotas(filtrosPadrao({ clienteId: cliente, situacao }), HOJE);
      const esperadas = linhas.filter((l) => situacaoDaNota(l, HOJE) === situacao).map((l) => l.id).sort();
      expect(filtradas.notas.map((n) => n.id).sort()).toEqual(esperadas);
      expect(filtradas.total).toBe(esperadas.length);
    }
  });
});

describe("listagem — filtros, busca, ordenação, paginação", () => {
  it("paginação no servidor com total correto; página além do fim → vazia com total", async () => {
    const cliente = await criarCliente();
    for (let i = 1; i <= 7; i++) await inserirNota(cliente, { numero: `PG-${i}`, emissao: `2026-01-${String(i).padStart(2, "0")}` });

    const p1 = await listarNotas(filtrosPadrao({ clienteId: cliente, porPagina: 3, ordenar: "data_emissao", direcao: "asc" }), HOJE);
    const p3 = await listarNotas(filtrosPadrao({ clienteId: cliente, porPagina: 3, pagina: 3, ordenar: "data_emissao", direcao: "asc" }), HOJE);
    const p9 = await listarNotas(filtrosPadrao({ clienteId: cliente, porPagina: 3, pagina: 9 }), HOJE);

    expect(p1.total).toBe(7);
    expect(p1.notas.map((n) => n.numero_nf)).toEqual(["PG-1", "PG-2", "PG-3"]);
    expect(p3.notas.map((n) => n.numero_nf)).toEqual(["PG-7"]);
    expect(p9).toEqual({ notas: [], total: 7 });
  });

  it("busca por número é literal (% e _ não viram curinga) e filtro por competência", async () => {
    const cliente = await criarCliente();
    await inserirNota(cliente, { numero: "NF_100%", competencia: "2026-03-01" });
    await inserirNota(cliente, { numero: "NFX1000", competencia: "2026-04-01" });

    const busca = await listarNotas(filtrosPadrao({ clienteId: cliente, busca: "_100%" }), HOJE);
    expect(busca.notas.map((n) => n.numero_nf)).toEqual(["NF_100%"]);

    const competencia = await listarNotas(filtrosPadrao({ clienteId: cliente, competencia: "2026-04-01" }), HOJE);
    expect(competencia.notas.map((n) => n.numero_nf)).toEqual(["NFX1000"]);
  });

  it("ordenação por valor (numérica, não alfabética)", async () => {
    const cliente = await criarCliente();
    for (const valor of ["900.00", "1000.00", "50.00"]) await inserirNota(cliente, { valor });
    const { notas } = await listarNotas(filtrosPadrao({ clienteId: cliente, ordenar: "valor", direcao: "asc" }), HOJE);
    expect(notas.map((n) => n.valor)).toEqual(["50.00", "900.00", "1000.00"]);
  });
});

describe("criarNota", () => {
  const dados = (clienteId: string, numero: string | null) => ({ clienteId, tipo: "mensalidade" as const, competencia: "2026-02-01", numeroNf: numero, valorCentavos: 123456, dataEmissao: "2026-02-03" });

  it("grava valor exato (centavos → numeric), status aguardando_atesto e evento de criação com autor", async () => {
    const cliente = await criarCliente();
    const r = await criarNota(dados(cliente, "CR-1"), equipeId);
    if (!r.ok) throw new Error("esperava ok");
    const [nota] = await query<{ valor: string; status: string; competencia: string }>(`select valor, status, competencia from nota_fiscal where id = $1`, [r.id]);
    expect(nota).toEqual({ valor: "1234.56", status: "aguardando_atesto", competencia: "2026-02-01" });
    const eventos = await listarEventos(r.id);
    expect(eventos!.map((e) => [e.tipo, e.feito_por_nome])).toEqual([["criacao", "Pessoa Notas"]]);
  });

  it.each(["suspenso", "encerrado"] as const)("cliente %s → recusado, nada gravado", async (status) => {
    const cliente = await criarCliente(status);
    expect(await criarNota(dados(cliente, "X-1"), equipeId)).toEqual({ ok: false, motivo: "cliente_inativo", statusContrato: status });
    expect(await query(`select 1 from nota_fiscal where cliente_id = $1`, [cliente])).toHaveLength(0);
  });

  it("cliente inexistente → recusado", async () => {
    expect(await criarNota(dados(randomUUID(), "X-2"), equipeId)).toEqual({ ok: false, motivo: "cliente_inexistente" });
  });

  it("número repetido no MESMO cliente → recusado (índice único 0008); outro cliente pode usar o mesmo número; nota sem número nunca conflita", async () => {
    const a = await criarCliente();
    const b = await criarCliente();
    expect((await criarNota(dados(a, "DUP-1"), equipeId)).ok).toBe(true);
    expect(await criarNota(dados(a, "DUP-1"), equipeId)).toEqual({ ok: false, motivo: "numero_duplicado" });
    expect((await criarNota(dados(b, "DUP-1"), equipeId)).ok).toBe(true);
    expect((await criarNota(dados(a, null), equipeId)).ok).toBe(true);
    expect((await criarNota(dados(a, null), equipeId)).ok).toBe(true);
  });
});

describe("executarAcaoNota — máquina de estados com lock", () => {
  it("duas ações de pagamento SIMULTÂNEAS na mesma nota → uma passa, a outra é 409 (nunca pagamento em dobro)", async () => {
    const cliente = await criarCliente();
    const nota = await inserirNota(cliente, { emissao: somarDias(HOJE, -20), atesto: somarDias(HOJE, -10), status: "atestada" });

    const [a, b] = await Promise.all([
      executarAcaoNota(nota, "registrar_pagamento", { dataEvento: HOJE }, equipeId, HOJE),
      executarAcaoNota(nota, "registrar_pagamento", { dataEvento: HOJE }, equipeId, HOJE)
    ]);

    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const recusada = (a.ok ? b : a) as { ok: false; motivo: string };
    expect(recusada.motivo).toBe("transicao_invalida");
    const eventos = await listarEventos(nota);
    expect(eventos!.filter((e) => e.tipo === "pagamento")).toHaveLength(1);
  });

  it("datas: atesto antes da emissão e pagamento antes do atesto → dados_invalidos, nada muda", async () => {
    const cliente = await criarCliente();
    const nota = await inserirNota(cliente, { emissao: "2026-01-10" });
    expect(await executarAcaoNota(nota, "registrar_atesto", { dataEvento: "2026-01-09" }, equipeId, HOJE)).toMatchObject({ ok: false, motivo: "dados_invalidos" });
    expect((await executarAcaoNota(nota, "registrar_atesto", { dataEvento: "2026-01-15" }, equipeId, HOJE)).ok).toBe(true);
    expect(await executarAcaoNota(nota, "registrar_pagamento", { dataEvento: "2026-01-14" }, equipeId, HOJE)).toMatchObject({ ok: false, motivo: "dados_invalidos" });
    const [linha] = await query<{ data_pagamento: string | null }>(`select data_pagamento from nota_fiscal where id = $1`, [nota]);
    expect(linha.data_pagamento).toBeNull();
  });

  it("atesto resolve o alerta sem_atesto_prolongado; cancelar resolve todos; status gravado já vem derivado", async () => {
    const cliente = await criarCliente();
    const nota = await inserirNota(cliente, { emissao: somarDias(HOJE, -120) });
    await query(`insert into alerta_cobranca (nota_fiscal_id, tipo) values ($1, 'sem_atesto_prolongado')`, [nota]);

    // Atesto retroativo de 100 dias → já nasce atraso_critico (70 dias depois do limite).
    const r = await executarAcaoNota(nota, "registrar_atesto", { dataEvento: somarDias(HOJE, -100) }, equipeId, HOJE);
    expect(r).toMatchObject({ ok: true, statusNovo: "atraso_critico" });
    const [n1] = await query<{ status: string }>(`select status from nota_fiscal where id = $1`, [nota]);
    expect(n1.status).toBe("atraso_critico");
    expect(await query(`select 1 from alerta_cobranca where nota_fiscal_id = $1 and status <> 'resolvido'`, [nota])).toHaveLength(0);

    await query(`insert into alerta_cobranca (nota_fiscal_id, tipo) values ($1, 'atraso_60_dias')`, [nota]);
    expect((await executarAcaoNota(nota, "cancelar", { motivo: "Emitida em duplicidade" }, equipeId, HOJE)).ok).toBe(true);
    const [n2] = await query<{ status: string; motivo_cancelamento: string; cancelado_por: string }>(
      `select status, motivo_cancelamento, cancelado_por from nota_fiscal where id = $1`,
      [nota]
    );
    expect(n2).toEqual({ status: "cancelada", motivo_cancelamento: "Emitida em duplicidade", cancelado_por: equipeId });
    expect(await query(`select 1 from alerta_cobranca where nota_fiscal_id = $1 and status <> 'resolvido'`, [nota])).toHaveLength(0);
  });

  it("transições inválidas com banco real → 409 (pagar cancelada, cancelar paga) e nenhum evento novo", async () => {
    const cliente = await criarCliente();
    const cancelada = await inserirNota(cliente, { status: "cancelada" });
    const paga = await inserirNota(cliente, { atesto: "2026-01-05", pagamento: "2026-01-20", status: "paga" });
    expect(await executarAcaoNota(cancelada, "registrar_pagamento", { dataEvento: HOJE }, equipeId, HOJE)).toMatchObject({ ok: false, motivo: "transicao_invalida" });
    expect(await executarAcaoNota(paga, "cancelar", { motivo: "x" }, equipeId, HOJE)).toMatchObject({ ok: false, motivo: "transicao_invalida" });
    expect(await query(`select 1 from nota_fiscal_evento where nota_fiscal_id = any($1::uuid[])`, [[cancelada, paga]])).toHaveLength(0);
  });
});
