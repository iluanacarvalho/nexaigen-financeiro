// CSV de entidades (lib/entidadesCsv.ts) e regras de lib/entidades.ts —
// leitura (";" ou ",", aspas, BOM), validação de TUDO com erro por linha,
// consistência dos dados repetidos, verificação antiga.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lerCsv, relatorioErrosCsv, validarCsvEntidades, COLUNAS_CSV_ENTIDADES } from "./entidadesCsv";
import { lerDataCsv, verificacaoAntiga } from "./entidades";

const HOJE = "2026-11-18";
const CONHECIDOS = new Set(["4106902", "4113700", "4115200"]);
const CAB = COLUNAS_CSV_ENTIDADES.join(";");
const linha = (extra: Partial<Record<(typeof COLUNAS_CSV_ENTIDADES)[number], string>>) => {
  const base: Record<string, string> = {
    entidade_nome: "Associação Teste", sigla: "AT", tipo: "associacao_municipios", uf: "PR", site: "https://at.invalid", contato_nome: "", contato_email: "",
    contato_telefone: "", observacao: "", fonte_url: "https://at.invalid/fonte", verificado_em: "2026-01-10", codigo_ibge_membro: "4106902", ...extra
  };
  return COLUNAS_CSV_ENTIDADES.map((c) => base[c]).join(";");
};

describe("lerCsv", () => {
  it("BOM, CRLF, aspas com separador e aspas internas; separador detectado pelo cabeçalho", () => {
    expect(lerCsv('﻿a;b\r\n"x;y";"di ""z"""\r\n')).toEqual([["a", "b"], ["x;y", 'di "z"']]);
    expect(lerCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("validarCsvEntidades", () => {
  it("válido: agrupa as linhas da mesma entidade (nome sem caixa + UF) com os membros", () => {
    const r = validarCsvEntidades([CAB, linha({}), linha({ codigo_ibge_membro: "4113700" }), linha({ entidade_nome: "Outra", sigla: "", verificado_em: "15/03/2026", codigo_ibge_membro: "4106902" })].join("\n"), CONHECIDOS, HOJE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linhasLidas).toBe(3);
    expect(r.entidades.map((e) => [e.nome, e.sigla, e.membros, e.linhas, e.verificado_em])).toEqual([
      ["Associação Teste", "AT", ["4106902", "4113700"], [2, 3], "2026-01-10"],
      ["Outra", null, ["4106902"], [4], "2026-03-15"]
    ]);
  });

  it("QUALQUER erro → ok false com TODAS as linhas problemáticas, cada uma com o motivo", () => {
    const csv = [
      CAB,
      linha({}),
      linha({ fonte_url: "", verificado_em: "" }), // 3
      linha({ entidade_nome: "Entidade B", tipo: "clube", codigo_ibge_membro: "9999999" }), // 4
      linha({ entidade_nome: "Entidade C", contato_email: "nao-e-email", codigo_ibge_membro: "123" }), // 5
      linha({ sigla: "OUTRA" }), // 6: dados diferentes da linha 2
      linha({ entidade_nome: "Entidade D", verificado_em: "2027-01-01" }), // 7: futuro
      linha({ codigo_ibge_membro: "4106902" }) // 8: membro repetido
    ].join("\n");
    const r = validarCsvEntidades(csv, CONHECIDOS, HOJE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.map((e) => e.linha)).toEqual([3, 4, 5, 6, 7, 8]);
    const texto = relatorioErrosCsv(r.erros);
    expect(texto).toMatch(/linha 3: fonte_url: Informe a fonte.*verificado_em: Informe a data da verificação/);
    expect(texto).toMatch(/linha 4: tipo: Tipo inválido.*codigo_ibge_membro: 9999999 não está na base/);
    expect(texto).toMatch(/linha 5: .*contato_email: E-mail inválido.*codigo_ibge_membro: "123" não tem 7 dígitos/);
    expect(texto).toMatch(/linha 6: Dados da entidade diferentes da linha 2 \(sigla\)/);
    expect(texto).toMatch(/linha 7: verificado_em: a data da verificação não pode estar no futuro/);
    expect(texto).toMatch(/linha 8: codigo_ibge_membro: 4106902 repetido nesta entidade/);
  });

  it("cabeçalho errado, arquivo vazio e coluna a mais na linha", () => {
    expect(validarCsvEntidades("nome;tipo\nx;y", CONHECIDOS, HOJE)).toMatchObject({ ok: false, erros: [{ linha: 1, erros: [expect.stringMatching(/^Faltam colunas: entidade_nome, sigla/), "Colunas desconhecidas: nome."] }] });
    expect(validarCsvEntidades(CAB + "\n\n", CONHECIDOS, HOJE)).toEqual({ ok: false, erros: [{ linha: 1, erros: ["O arquivo não tem nenhuma linha de dados."] }] });
    expect(validarCsvEntidades(`${CAB}\n${linha({})};extra`, CONHECIDOS, HOJE)).toMatchObject({ ok: false, erros: [{ linha: 2 }] });
  });

  it("o MODELO commitado (docs/modelos/entidades-modelo.csv) é válido e claramente fictício", () => {
    const conteudo = readFileSync("docs/modelos/entidades-modelo.csv", "utf-8");
    const r = validarCsvEntidades(conteudo, CONHECIDOS, HOJE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.linhasLidas).toBe(2);
      expect(r.entidades[0].nome).toMatch(/FICTÍCIO/);
      expect(r.entidades[0].fonte_url).toMatch(/\.invalid/);
    }
  });
});

describe("verificação e datas", () => {
  it("verificação ANTIGA = mais de 12 meses (12 meses exatos ainda não)", () => {
    expect(verificacaoAntiga("2025-11-18", HOJE)).toBe(false);
    expect(verificacaoAntiga("2025-11-17", HOJE)).toBe(true);
    expect(verificacaoAntiga("2026-11-18", HOJE)).toBe(false);
  });
  it("data do CSV: aaaa-mm-dd ou dd/mm/aaaa, e só data que existe", () => {
    expect(lerDataCsv("31/03/2026")).toBe("2026-03-31");
    expect(lerDataCsv("2026-03-31")).toBe("2026-03-31");
    for (const d of ["31/02/2026", "2026-13-01", "03/31/2026", ""]) expect(lerDataCsv(d)).toBeNull();
  });
});
