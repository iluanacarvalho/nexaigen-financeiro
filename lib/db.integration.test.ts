// Primeira suíte de integração deste projeto (rodada de migração de
// infraestrutura Supabase → pg direto) — testa contra Postgres REAL (não
// mockado) exatamente os dois pontos que um mock poderia disfarçar um
// erro de SQL genuíno: o trigger `calcular_data_limite` e o índice único
// parcial `uq_alerta_ativo`.
//
// Depende do Postgres real do Docker Compose estar no ar e migrado:
//   docker compose up -d && npm run migrate && npm run test:integration

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { query } from "./db";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

let clienteId: string;

beforeAll(async () => {
  const linhas = await query<{ id: string }>(
    `insert into cliente_prefeitura (nome, uf, valor_mensal, data_inicio_contrato)
     values ($1, 'PR', 1000, current_date) returning id`,
    [`Prefeitura Teste DB Integration ${randomUUID().slice(0, 8)}`]
  );
  clienteId = linhas[0].id;
});

afterAll(async () => {
  await query(`delete from cliente_prefeitura where id = $1`, [clienteId]);
});

describe("trigger calcular_data_limite — Postgres real", () => {
  it("INSERT com data_atesto calcula data_limite_pagamento = data_atesto + 30 dias, pelo PRÓPRIO banco", async () => {
    const linhas = await query<{ data_atesto: string; data_limite_pagamento: string }>(
      `insert into nota_fiscal (cliente_id, competencia, valor, data_atesto)
       values ($1, current_date, 500, '2026-01-01')
       returning data_atesto, data_limite_pagamento`,
      [clienteId]
    );
    expect(linhas[0].data_atesto).toBe("2026-01-01");
    expect(linhas[0].data_limite_pagamento).toBe("2026-01-31");

    await query(`delete from nota_fiscal where cliente_id = $1`, [clienteId]);
  });

  it("UPDATE que preenche data_atesto (nota emitida sem atesto ainda) recalcula data_limite_pagamento também", async () => {
    const criadas = await query<{ id: string }>(
      `insert into nota_fiscal (cliente_id, competencia, valor) values ($1, current_date, 500) returning id`,
      [clienteId]
    );
    const notaId = criadas[0].id;

    const semAtesto = await query<{ data_limite_pagamento: string | null }>(
      `select data_limite_pagamento from nota_fiscal where id = $1`,
      [notaId]
    );
    expect(semAtesto[0].data_limite_pagamento).toBeNull();

    const atualizadas = await query<{ data_limite_pagamento: string }>(
      `update nota_fiscal set data_atesto = '2026-03-10' where id = $1 returning data_limite_pagamento`,
      [notaId]
    );
    expect(atualizadas[0].data_limite_pagamento).toBe("2026-04-09");

    await query(`delete from nota_fiscal where id = $1`, [notaId]);
  });
});

describe("índice único parcial uq_alerta_ativo — Postgres real", () => {
  it("duas tentativas de insert do MESMO alerta ativo — só a primeira retorna linha no RETURNING", async () => {
    const criadas = await query<{ id: string }>(
      `insert into nota_fiscal (cliente_id, competencia, valor) values ($1, current_date, 800) returning id`,
      [clienteId]
    );
    const notaId = criadas[0].id;

    const primeira = await query<{ id: string }>(
      `insert into alerta_cobranca (nota_fiscal_id, tipo, status)
       values ($1, 'vencido', 'pendente')
       on conflict (nota_fiscal_id, tipo) where status <> 'resolvido' do nothing
       returning id`,
      [notaId]
    );
    expect(primeira).toHaveLength(1);

    const segunda = await query<{ id: string }>(
      `insert into alerta_cobranca (nota_fiscal_id, tipo, status)
       values ($1, 'vencido', 'pendente')
       on conflict (nota_fiscal_id, tipo) where status <> 'resolvido' do nothing
       returning id`,
      [notaId]
    );
    expect(segunda).toHaveLength(0);

    // Confirma que existe só UMA linha de verdade na tabela — o índice
    // não só recusou o RETURNING, recusou o INSERT em si.
    const contagem = await query<{ total: string }>(
      `select count(*) as total from alerta_cobranca where nota_fiscal_id = $1 and tipo = 'vencido'`,
      [notaId]
    );
    expect(Number(contagem[0].total)).toBe(1);

    // Resolvendo o alerta libera o índice pra um novo ciclo (mesmo tipo,
    // nota diferente estágio) — comportamento intencional (ver
    // README.md Seção 6, "por que nenhuma coluna nova foi necessária").
    await query(`update alerta_cobranca set status = 'resolvido', resolvido_em = now() where nota_fiscal_id = $1`, [notaId]);
    const terceira = await query<{ id: string }>(
      `insert into alerta_cobranca (nota_fiscal_id, tipo, status)
       values ($1, 'vencido', 'pendente')
       on conflict (nota_fiscal_id, tipo) where status <> 'resolvido' do nothing
       returning id`,
      [notaId]
    );
    expect(terceira).toHaveLength(1);

    await query(`delete from nota_fiscal where id = $1`, [notaId]);
  });
});

describe("colunas arquivo_pdf_chave/arquivo_pdf_nome (0002_nota_fiscal_arquivo_pdf.sql) — Postgres real", () => {
  it("nascem nulas, e persistem depois de um UPDATE (mesma escrita que POST /api/notas/[id]/arquivo faz)", async () => {
    const criadas = await query<{ arquivo_pdf_chave: string | null; arquivo_pdf_nome: string | null }>(
      `insert into nota_fiscal (cliente_id, competencia, valor) values ($1, current_date, 900)
       returning arquivo_pdf_chave, arquivo_pdf_nome`,
      [clienteId]
    );
    expect(criadas[0].arquivo_pdf_chave).toBeNull();
    expect(criadas[0].arquivo_pdf_nome).toBeNull();

    const notaId = (
      await query<{ id: string }>(`select id from nota_fiscal where cliente_id = $1 order by created_at desc limit 1`, [clienteId])
    )[0].id;

    const chave = `financeiro/notas-fiscais/${notaId}/NF-e_teste.pdf`;
    const atualizadas = await query<{ arquivo_pdf_chave: string; arquivo_pdf_nome: string }>(
      `update nota_fiscal set arquivo_pdf_chave = $1, arquivo_pdf_nome = $2 where id = $3
       returning arquivo_pdf_chave, arquivo_pdf_nome`,
      [chave, "NF-e teste.pdf", notaId]
    );
    expect(atualizadas[0].arquivo_pdf_chave).toBe(chave);
    expect(atualizadas[0].arquivo_pdf_nome).toBe("NF-e teste.pdf");

    // Lido de volta numa consulta separada — confirma persistência real,
    // não só o RETURNING da própria escrita.
    const relidas = await query<{ arquivo_pdf_chave: string; arquivo_pdf_nome: string }>(
      `select arquivo_pdf_chave, arquivo_pdf_nome from nota_fiscal where id = $1`,
      [notaId]
    );
    expect(relidas[0].arquivo_pdf_chave).toBe(chave);
    expect(relidas[0].arquivo_pdf_nome).toBe("NF-e teste.pdf");

    await query(`delete from nota_fiscal where id = $1`, [notaId]);
  });
});
