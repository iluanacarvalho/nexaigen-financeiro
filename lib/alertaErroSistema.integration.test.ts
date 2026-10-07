// Teste de integração de lib/alertaErroSistema.ts contra Postgres REAL —
// prova o que um mock de `query` não provaria: que o
// `insert ... where not exists (...)` é de fato atômico e decide
// corretamente "debounçar ou não" contra o estado real de
// log_alerta_sistema (0003_log_alerta_sistema.sql). Mocka SOMENTE a
// camada de envio de e-mail (Resend), nunca o banco — mesmo padrão de
// app/api/cron/verificar-prazos/route.integration.test.ts.
//
// Cada teste usa uma categoria ÚNICA (randomUUID) — a tabela não tem
// isolamento por teste nenhum (é um log compartilhado), então duas
// categorias nunca podem colidir entre testes rodando em sequência.
//
// Depende do Postgres real do Docker Compose estar no ar e migrado:
//   docker compose up -d && npm run migrate && npm run test:integration

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function ResendMock() {
    return { emails: { send: sendMock } };
  })
}));

import { query } from "./db";
import { alertarErroSistema } from "./alertaErroSistema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Rode: docker compose up -d && npm run migrate && npm run test:integration");
}

const ENV_ORIGINAL = {
  resendApiKey: process.env.RESEND_API_KEY,
  destino: process.env.ALERTA_SISTEMA_EMAILS_DESTINO,
  remetente: process.env.ALERTA_EMAIL_REMETENTE
};

function categoriaUnica(sufixo: string): string {
  return `teste_integracao_${sufixo}_${randomUUID().slice(0, 8)}`;
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: "email-fake-id" }, error: null });
  process.env.RESEND_API_KEY = "re_teste_fake";
  process.env.ALERTA_SISTEMA_EMAILS_DESTINO = "luana@nexaigen.com.br,suporte@nexaigen.com.br";
  process.env.ALERTA_EMAIL_REMETENTE = "alertas@nexaigen.com.br";
});

afterAll(async () => {
  await query(`delete from log_alerta_sistema where categoria like 'teste_integracao_%'`);
  if (ENV_ORIGINAL.resendApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ENV_ORIGINAL.resendApiKey;
  if (ENV_ORIGINAL.destino === undefined) delete process.env.ALERTA_SISTEMA_EMAILS_DESTINO;
  else process.env.ALERTA_SISTEMA_EMAILS_DESTINO = ENV_ORIGINAL.destino;
  if (ENV_ORIGINAL.remetente === undefined) delete process.env.ALERTA_EMAIL_REMETENTE;
  else process.env.ALERTA_EMAIL_REMETENTE = ENV_ORIGINAL.remetente;
});

describe("alertarErroSistema — debounce real contra Postgres", () => {
  it("primeira chamada de uma categoria nova — registra em log_alerta_sistema e envia o e-mail", async () => {
    const categoria = categoriaUnica("primeira");

    await alertarErroSistema(categoria, "mensagem de teste");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const linhas = await query<{ categoria: string; mensagem: string }>(
      `select categoria, mensagem from log_alerta_sistema where categoria = $1`,
      [categoria]
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].mensagem).toBe("mensagem de teste");
  });

  it("segunda chamada da MESMA categoria, logo em seguida (dentro de 30min) — debounçada: não insere linha nova, não reenvia e-mail", async () => {
    const categoria = categoriaUnica("debounce");

    await alertarErroSistema(categoria, "primeira tentativa");
    expect(sendMock).toHaveBeenCalledTimes(1);

    await alertarErroSistema(categoria, "segunda tentativa, deve ser ignorada");
    expect(sendMock).toHaveBeenCalledTimes(1); // continua 1, não foi pra 2

    const linhas = await query<{ mensagem: string }>(`select mensagem from log_alerta_sistema where categoria = $1`, [categoria]);
    expect(linhas).toHaveLength(1); // continua só UMA linha real na tabela
    expect(linhas[0].mensagem).toBe("primeira tentativa"); // a segunda nunca foi gravada
  });

  it("categoria com um registro de mais de 30 minutos atrás — NÃO debounça, insere nova linha e reenvia o e-mail", async () => {
    const categoria = categoriaUnica("vencido");

    // Simula uma tentativa antiga diretamente via SQL — fora da janela de
    // debounce de 30 minutos.
    await query(
      `insert into log_alerta_sistema (categoria, mensagem, enviado_em) values ($1, 'tentativa antiga', now() - interval '31 minutes')`,
      [categoria]
    );

    await alertarErroSistema(categoria, "tentativa nova, fora da janela de debounce");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const linhas = await query<{ mensagem: string }>(
      `select mensagem from log_alerta_sistema where categoria = $1 order by enviado_em asc`,
      [categoria]
    );
    expect(linhas).toHaveLength(2);
    expect(linhas[1].mensagem).toBe("tentativa nova, fora da janela de debounce");
  });

  it("duas categorias diferentes nunca compartilham a mesma janela de debounce", async () => {
    const categoriaA = categoriaUnica("independente_a");
    const categoriaB = categoriaUnica("independente_b");

    await alertarErroSistema(categoriaA, "falha A");
    await alertarErroSistema(categoriaB, "falha B");

    expect(sendMock).toHaveBeenCalledTimes(2);
    const linhasA = await query<{ id: string }>(`select id from log_alerta_sistema where categoria = $1`, [categoriaA]);
    const linhasB = await query<{ id: string }>(`select id from log_alerta_sistema where categoria = $1`, [categoriaB]);
    expect(linhasA).toHaveLength(1);
    expect(linhasB).toHaveLength(1);
  });
});
