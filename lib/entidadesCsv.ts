// CSV de entidades intermunicipais (rodada 16-A2) — leitura e validação
// PURAS (scripts/importar-entidades-csv.ts grava com lib/entidadesServico.ts).
//
// Modelo em docs/modelos/entidades-modelo.csv: UMA LINHA POR MEMBRO — os
// dados da entidade se repetem em cada linha e precisam ser IGUAIS em todas
// as linhas da mesma entidade (mesmo nome + UF). Separador ";" (Excel pt-BR)
// ou "," — detectado pelo cabeçalho. Aspas no padrão RFC 4180.
// verificado_em em aaaa-mm-dd ou dd/mm/aaaa. Linha sem codigo_ibge_membro =
// só a entidade, sem membro naquela linha.
//
// TUDO é validado antes de gravar: qualquer erro → nada é gravado e o
// relatório sai LINHA A LINHA (número da linha no arquivo, cabeçalho = 1).

import { codigoIbgeValido } from "./ibge";
import { lerDataCsv } from "./entidades";
import { EntidadeCamposSchema, type EntidadeCampos } from "./entidadeSchemas";
import { detalhesDoErro } from "./validacao";

export const COLUNAS_CSV_ENTIDADES = [
  "entidade_nome", "sigla", "tipo", "uf", "site", "contato_nome", "contato_email", "contato_telefone",
  "observacao", "fonte_url", "verificado_em", "codigo_ibge_membro"
] as const;

/** Lê o CSV (BOM, CRLF, aspas). Separador: ";" se o cabeçalho tiver ";", senão ",". */
export function lerCsv(conteudo: string): string[][] {
  const texto = conteudo.replace(/^﻿/, "");
  const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
  const sep = primeira.includes(";") ? ";" : ",";
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"' && campo === "") aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

export interface EntidadeDoCsv extends EntidadeCampos {
  membros: string[];
  /** Linhas do arquivo desta entidade (pra relatório). */
  linhas: number[];
}

export type ResultadoCsvEntidades = { ok: true; entidades: EntidadeDoCsv[]; linhasLidas: number } | { ok: false; erros: { linha: number; erros: string[] }[] };

/** Chave da entidade: nome sem caixa + UF (a mesma do índice único uq_entidade_nome_uf). */
export function chaveEntidade(nome: string, uf: string | null): string {
  return `${nome.trim().toLowerCase()}|${uf ?? ""}`;
}

const ROTULO_COLUNA: Record<string, string> = { nome: "entidade_nome" };

/**
 * Valida o CSV INTEIRO. `codigosConhecidos` = códigos que existem em
 * municipio_base (quem chama consulta o banco). `hoje` (America/Sao_Paulo)
 * barra verificado_em no futuro. Qualquer erro → { ok: false } com TODAS as
 * linhas problemáticas.
 */
export function validarCsvEntidades(conteudo: string, codigosConhecidos: ReadonlySet<string>, hoje: string): ResultadoCsvEntidades {
  const linhas = lerCsv(conteudo);
  const erros: { linha: number; erros: string[] }[] = [];
  const cabecalho = (linhas[0] ?? []).map((c) => c.trim().toLowerCase());
  const faltando = COLUNAS_CSV_ENTIDADES.filter((c) => !cabecalho.includes(c));
  const sobrando = cabecalho.filter((c) => c !== "" && !(COLUNAS_CSV_ENTIDADES as readonly string[]).includes(c));
  if (faltando.length || sobrando.length) {
    return {
      ok: false,
      erros: [{ linha: 1, erros: [...(faltando.length ? [`Faltam colunas: ${faltando.join(", ")}.`] : []), ...(sobrando.length ? [`Colunas desconhecidas: ${sobrando.join(", ")}.`] : [])] }]
    };
  }
  const indice = Object.fromEntries(COLUNAS_CSV_ENTIDADES.map((c) => [c, cabecalho.indexOf(c)])) as Record<(typeof COLUNAS_CSV_ENTIDADES)[number], number>;

  const porChave = new Map<string, EntidadeDoCsv>();
  let lidas = 0;
  linhas.slice(1).forEach((valores, i) => {
    const numero = i + 2;
    if (valores.every((v) => v.trim() === "")) return; // linha em branco
    lidas++;
    const v = (c: (typeof COLUNAS_CSV_ENTIDADES)[number]) => (valores[indice[c]] ?? "").trim();
    const problemas: string[] = [];
    if (valores.length > cabecalho.length) problemas.push(`A linha tem ${valores.length} colunas, o cabeçalho tem ${cabecalho.length}.`);

    const dataLida = v("verificado_em") === "" ? "" : (lerDataCsv(v("verificado_em")) ?? "invalida");
    const parsed = EntidadeCamposSchema.safeParse({
      nome: v("entidade_nome"),
      sigla: v("sigla"),
      tipo: v("tipo"),
      uf: v("uf").toUpperCase(),
      site: v("site"),
      contato_nome: v("contato_nome"),
      contato_email: v("contato_email"),
      contato_telefone: v("contato_telefone"),
      observacao: v("observacao"),
      fonte_url: v("fonte_url"),
      verificado_em: dataLida
    });
    if (!parsed.success) {
      const d = detalhesDoErro(parsed.error);
      for (const [campo, mensagens] of Object.entries(d.fieldErrors)) problemas.push(`${ROTULO_COLUNA[campo] ?? campo}: ${(mensagens as string[]).join(" ")}`);
      problemas.push(...d.formErrors);
    } else if (parsed.data.verificado_em > hoje) problemas.push("verificado_em: a data da verificação não pode estar no futuro.");

    const codigo = v("codigo_ibge_membro");
    if (codigo !== "" && !codigoIbgeValido(codigo)) problemas.push(`codigo_ibge_membro: "${codigo}" não tem 7 dígitos.`);
    else if (codigo !== "" && !codigosConhecidos.has(codigo)) problemas.push(`codigo_ibge_membro: ${codigo} não está na base de municípios (importe o estado antes).`);

    if (parsed.success) {
      const chave = chaveEntidade(parsed.data.nome, parsed.data.uf);
      const existente = porChave.get(chave);
      if (existente) {
        const diferentes = (Object.keys(parsed.data) as (keyof EntidadeCampos)[]).filter((k) => existente[k] !== parsed.data[k]);
        if (diferentes.length) problemas.push(`Dados da entidade diferentes da linha ${existente.linhas[0]} (${diferentes.map((k) => ROTULO_COLUNA[k] ?? k).join(", ")}) — repita os mesmos dados em todas as linhas da entidade.`);
        else if (codigo !== "" && existente.membros.includes(codigo)) problemas.push(`codigo_ibge_membro: ${codigo} repetido nesta entidade.`);
        if (!problemas.length) {
          if (codigo !== "") existente.membros.push(codigo);
          existente.linhas.push(numero);
        }
      } else if (!problemas.length) {
        porChave.set(chave, { ...parsed.data, membros: codigo === "" ? [] : [codigo], linhas: [numero] });
      }
    }
    if (problemas.length) erros.push({ linha: numero, erros: problemas });
  });
  if (lidas === 0 && erros.length === 0) erros.push({ linha: 1, erros: ["O arquivo não tem nenhuma linha de dados."] });
  return erros.length ? { ok: false, erros } : { ok: true, entidades: [...porChave.values()], linhasLidas: lidas };
}

/** Relatório legível dos erros (um por linha). */
export function relatorioErrosCsv(erros: { linha: number; erros: string[] }[]): string {
  return erros.map((e) => `linha ${e.linha}: ${e.erros.join(" | ")}`).join("\n");
}
