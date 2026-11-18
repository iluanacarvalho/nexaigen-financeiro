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

export interface BancoTemporario {
  nome: string;
  url: string;
  /** Derruba o banco (mesmo com conexões abertas). Idempotente. */
  derrubar: () => Promise<void>;
}

export async function criarBancoTemporario(prefixo: string): Promise<BancoTemporario> {
  if (!bancoLocal()) throw new Error("Banco temporário só com DATABASE_URL local.");
  const original = process.env.DATABASE_URL!;
  const nome = `financeiro_teste_${prefixo}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const admin = new Client({ connectionString: original });
  await admin.connect();
  await admin.query(`create database "${nome}"`);
  const url = new URL(original);
  url.pathname = `/${nome}`;

  let derrubado = false;
  const derrubar = async () => {
    if (derrubado) return;
    derrubado = true;
    await admin.query(`drop database if exists "${nome}" with (force)`);
    await admin.end();
  };

  try {
    const migrador = new Client({ connectionString: url.toString() });
    await migrador.connect();
    try {
      await aplicarMigracoes(migrador, undefined, { desenvolvimento: true });
    } finally {
      await migrador.end();
    }
  } catch (erro) {
    await derrubar();
    throw erro;
  }
  return { nome, url: url.toString(), derrubar };
}
