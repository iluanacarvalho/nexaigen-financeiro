// Integração contra Postgres REAL (não mockado) do que um mock não pega:
// o índice único PARCIAL uq_cliente_municipio_id_externo
// (db/migrations/0004_integracao_educa.sql) e o upsert de
// POST /api/integracao/clientes apoiado nele (o `on conflict ... where`
// só funciona se bater exatamente com o predicado do índice — um erro
// aqui só aparece com o banco de verdade).
//
// Storage e alerta de sistema mockados — o foco é o banco.
//   docker compose up -d && npm run migrate && npm run test:integration

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/armazenamentoObjetos", () => ({ uploadArquivo: vi.fn(async () => true), gerarUrlDownload: vi.fn() }));
vi.mock("@/lib/alertaErroSistema", () => ({ alertarErroSistema: vi.fn() }));

import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { POST } from "./route";
import { chaveLimite } from "@/lib/rateLimit";
import { aguardarLongeDaViradaDaJanela } from "@/testes/janelaRateLimit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const SEGREDO = "segredo-de-teste-integracao-real";
const criados: string[] = [];

async function inserirDireto(municipioIdExterno: string | null): Promise<string> {
  const linhas = await query<{ id: string }>(
    `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato, municipio_id_externo)
     values ($1, 'PR', 1000, current_date, $2) returning id`,
    [`Prefeitura Teste Integração Educa ${randomUUID().slice(0, 8)}`, municipioIdExterno]
  );
  criados.push(linhas[0].id);
  return linhas[0].id;
}

beforeEach(() => {
  process.env.INTEGRACAO_SECRET = SEGREDO;
});

const ipsUsados = ["desconhecido"];

afterAll(async () => {
  await query(`delete from cliente_prefeitura where id = any($1::uuid[])`, [criados]);
  const chaves = ipsUsados.flatMap((ip) => [chaveLimite("integracao:ip", ip), chaveLimite("integracao:falha-auth", ip)]);
  await query(`delete from rate_limit_contador where chave = any($1::text[])`, [chaves]);
});

describe("índice único parcial uq_cliente_municipio_id_externo — Postgres real", () => {
  it("dois clientes com o MESMO municipio_id_externo — o segundo é erro de constraint (23505)", async () => {
    const municipio = randomUUID();
    await inserirDireto(municipio);
    await expect(inserirDireto(municipio)).rejects.toMatchObject({ code: "23505", constraint: "uq_cliente_municipio_id_externo" });
  });

  it("dois clientes com municipio_id_externo NULL (cadastro manual) coexistem sem conflito", async () => {
    const a = await inserirDireto(null);
    const b = await inserirDireto(null);
    expect(a).not.toBe(b);
  });
});

describe("POST /api/integracao/clientes — upsert real", () => {
  function chamar(corpo: Record<string, unknown>) {
    return POST(
      new NextRequest("http://localhost:3001/api/integracao/clientes", {
        method: "POST",
        headers: { authorization: `Bearer ${SEGREDO}`, "content-type": "application/json" },
        body: JSON.stringify(corpo)
      })
    );
  }

  it("1ª chamada INSERT (criado: true); retry do mesmo município vira UPDATE (criado: false, mesmo id), só os campos enviados mudam", async () => {
    const municipio = randomUUID();
    const base = { municipioIdExterno: municipio, nome: "Prefeitura Upsert Real", uf: "SP", valorMensal: 3000, dataInicioContrato: "2026-10-01" };

    const r1 = await (
      await chamar({
        ...base,
        plano: "completo",
        contatoEmail: "contato@prefeitura.example",
        contratoArquivoBase64: Buffer.from("%PDF-1.4 teste").toString("base64"),
        contratoArquivoNome: "contrato.pdf"
      })
    ).json();
    criados.push(r1.id);
    expect(r1.criado).toBe(true);

    const r2 = await (await chamar({ ...base, valorMensal: 3500, observacao: "retry" })).json();
    expect(r2).toEqual({ id: r1.id, criado: false });

    const [linha] = await query<Record<string, unknown>>(`select * from cliente_prefeitura where municipio_id_externo = $1`, [municipio]);
    expect(linha.valor_mensal).toBe("3500.00");
    expect(linha.observacao).toBe("retry");
    // Não enviados no retry — mantidos (coalesce), nunca resetados pro default/null.
    expect(linha.plano).toBe("completo");
    expect(linha.contato_email).toBe("contato@prefeitura.example");
    expect(linha.contrato_arquivo_nome).toBe("contrato.pdf");
    expect(linha.contrato_arquivo_chave).toMatch(/^financeiro\/contratos-prefeitura\/[0-9a-f-]{36}\/contrato\.pdf$/);

    const [{ total }] = await query<{ total: string }>(`select count(*) as total from cliente_prefeitura where municipio_id_externo = $1`, [municipio]);
    expect(Number(total)).toBe(1);
  });
});

describe("POST /api/integracao/clientes — limites por IP, contadores reais (rodada 07)", () => {
  function chamar(ip: string, auth: string, corpo: unknown = {}) {
    return POST(
      new NextRequest("http://localhost:3001/api/integracao/clientes", {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify(corpo)
      })
    );
  }
  const novoIp = () => {
    const ip = `teste-integracao-${randomUUID()}`;
    ipsUsados.push(ip);
    return ip;
  };

  it("10 segredos errados → 401 genérico cada; a 11ª → 429 MESMO com o segredo certo", async () => {
    await aguardarLongeDaViradaDaJanela(15 * 60, 10);
    const ip = novoIp();
    for (let i = 0; i < 10; i++) {
      const res = await chamar(ip, `Bearer errado-${i}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ erro: "Não autorizado." });
    }
    const res = await chamar(ip, `Bearer ${SEGREDO}`);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  it("chamadas autenticadas não acumulam falha: 15 com o segredo certo (corpo inválido → 400) seguem sem 429", async () => {
    const ip = novoIp();
    for (let i = 0; i < 15; i++) expect((await chamar(ip, `Bearer ${SEGREDO}`)).status).toBe(400);
  });

  it("60 requisições/min por IP: a 61ª → 429", async () => {
    await aguardarLongeDaViradaDaJanela(60, 15); // janela de 1 min — as 61 chamadas cabem numa janela só
    const ip = novoIp();
    for (let i = 0; i < 60; i++) expect((await chamar(ip, `Bearer ${SEGREDO}`)).status).toBe(400);
    expect((await chamar(ip, `Bearer ${SEGREDO}`)).status).toBe(429);
  });
});
