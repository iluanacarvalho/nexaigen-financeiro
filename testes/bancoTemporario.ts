// Helper SÓ de teste de integração (rodada 15-C, extraído na 16-A): cria
// um banco Postgres TEMPORÁRIO com nome único, aplica nele as MESMAS
// migrations do projeto (scripts/aplicarMigracoes.ts) e derruba no fim
// (DROP DATABASE ... WITH (FORCE)). Pra testes que precisam COMMITAR de
// verdade (concorrência entre conexões; trilhas somente-acréscimo que não
// podem ser apagadas depois, como o histórico do CRM) sem nunca escrever no
// banco local de desenvolvimento.
//
// Só funciona com DATABASE_URL LOCAL (localhost/127.0.0.1/::1) — nunca cria
// banco num servidor remoto. Quem usa deve pular o teste quando
// `bancoLocal()` for false.

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { aplicarMigracoes } from "../scripts/aplicarMigracoes";

export function bancoLocal(): boolean {
  if (!process.env.DATABASE_URL) return false;
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);
}

/**
 * Todo Client "pg" deste helper tem listener de "error" (rodada 16-A4): uma
 * conexão parada derrubada pelo servidor emite "error" — sem listener, vira
 * exceção não capturada e derruba o processo do vitest.
 */
export function ouvirErroDeConexao(cliente: Client, rotulo: string): Client {
  cliente.on("error", (erro: Error & { code?: string }) => {
    console.error(`[teste] conexão "${rotulo}" caiu (${erro.code ?? "sem código"}): ${erro.message.slice(0, 200)}`);
  });
  return cliente;
}

export interface BancoTemporario {
  nome: string;
  url: string;
  /**
   * Derruba o banco. ANTES, confere que ninguém mais está conectado a ele
   * (quem usou o banco tem de ter fechado pool e clientes — use
   * encerrarBancoTemporario); espera até 3 s conexões que ainda estão
   * fechando. Se sobrou alguém: derruba MESMO ASSIM (with force — não deixa
   * banco pra trás) e LANÇA dizendo quem era (aplicação, estado, consulta) —
   * o arquivo de teste falha apontando a conexão esquecida. Idempotente.
   */
  derrubar: () => Promise<void>;
}

export async function criarBancoTemporario(prefixo: string): Promise<BancoTemporario> {
  if (!bancoLocal()) throw new Error("Banco temporário só com DATABASE_URL local.");
  const original = process.env.DATABASE_URL!;
  const nome = `financeiro_teste_${prefixo}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const admin = ouvirErroDeConexao(new Client({ connectionString: original, application_name: "teste:banco-temporario" }), "admin do banco temporário");
  await admin.connect();
  await admin.query(`create database "${nome}"`);
  const url = new URL(original);
  url.pathname = `/${nome}`;

  let derrubado = false;
  const derrubar = async () => {
    if (derrubado) return;
    derrubado = true;
    const conectados = async () =>
      (
        await admin.query<{ pid: number; aplicacao: string; estado: string | null; consulta: string | null }>(
          `select pid, application_name as aplicacao, state as estado, left(regexp_replace(query, '\\s+', ' ', 'g'), 120) as consulta
           from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
          [nome]
        )
      ).rows;
    let sobras = await conectados();
    for (let i = 0; sobras.length > 0 && i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100)); // conexão que acabou de fechar some em milissegundos
      sobras = await conectados();
    }
    try {
      await admin.query(`drop database if exists "${nome}" with (force)`);
    } finally {
      await admin.end();
    }
    if (sobras.length > 0) {
      throw new Error(
        `Banco temporário ${nome} ainda tinha ${sobras.length} conexão(ões) abertas na hora do drop — feche o pool e os clientes ANTES (encerrarBancoTemporario):\n` +
          sobras.map((c) => `  pid ${c.pid} · ${c.aplicacao || "(sem nome)"} · ${c.estado ?? "—"} · ${c.consulta ?? ""}`).join("\n")
      );
    }
  };

  try {
    const migrador = ouvirErroDeConexao(new Client({ connectionString: url.toString() }), "migrador do banco temporário");
    await migrador.connect();
    try {
      // Como PRODUÇÃO (rodada 16-A3): nenhum seed de desenvolvimento (nada de PR liberado sozinho) — cada teste libera o que precisa.
      await aplicarMigracoes(migrador, undefined, { desenvolvimento: false });
    } finally {
      await migrador.end();
    }
  } catch (erro) {
    await derrubar();
    throw erro;
  }
  return { nome, url: url.toString(), derrubar };
}

/**
 * Pra arquivo de teste que faz DDL (rodada 16-A3): cria o banco temporário e
 * TROCA process.env.DATABASE_URL — tem de rodar ANTES de qualquer import de
 * lib/db (o pool lê a URL na importação). Uso, no topo do arquivo:
 *
 *   const banco = await vi.hoisted(async () => (await import("../testes/bancoTemporario")).trocarParaBancoTemporario("planos"));
 *   afterAll(() => encerrarBancoTemporario(banco));
 *
 * (`vi.hoisted` roda antes dos imports estáticos.) DATABASE_URL não local →
 * null: o teste de DDL PULA (describe.skipIf(!banco)) — nunca roda no banco
 * compartilhado.
 */
export async function trocarParaBancoTemporario(prefixo: string): Promise<BancoTemporario | null> {
  if (!bancoLocal()) return null;
  const banco = await criarBancoTemporario(prefixo);
  process.env.DATABASE_URL = banco.url;
  return banco;
}

/** Confere (no beforeAll) que o pool da aplicação está MESMO no banco temporário — senão aborta antes de qualquer DDL. */
export async function confirmarBancoTemporario(banco: BancoTemporario | null, consultar: (sql: string) => Promise<{ atual: string }[]>): Promise<void> {
  if (!banco) return;
  const [{ atual }] = await consultar("select current_database() as atual");
  if (atual !== banco.nome) throw new Error(`Fora do banco temporário (${atual}) — abortado antes de qualquer DDL.`);
}

/**
 * ENCERRA TUDO e só então derruba o banco (rodada 16-A4) — a ORDEM importa:
 * `drop database ... with (force)` mata as conexões que ainda estiverem
 * abertas, e uma conexão OCIOSA morta emite "error" (antes do listener do
 * pool, isso virava "Unhandled Error: terminating connection due to
 * administrator command" e o comando saía com código 1 mesmo com os testes
 * passando). Ordem: (1) clientes "pg" próprios do arquivo, (2) o pool da
 * aplicação (lib/db, em globalThis), (3) o drop — que ainda confere que não
 * sobrou ninguém conectado e falha apontando quem, se sobrou.
 */
export async function encerrarBancoTemporario(banco: BancoTemporario | null, ...clientes: { end: () => Promise<void> }[]): Promise<void> {
  await Promise.all(clientes.map((c) => c.end().catch(() => undefined)));
  const global = globalThis as { __nexaigenFinPgPool?: { end: () => Promise<void> } };
  await global.__nexaigenFinPgPool?.end().catch(() => undefined);
  delete global.__nexaigenFinPgPool; // pool encerrado não serve mais pra nada
  await banco?.derrubar();
}
