// lib/contratoModelo.ts (campos, validação ao salvar, renderização, faixa de
// rascunho) e lib/docx.ts (o .docx abre como ZIP, XML bem formado, faixa em
// todas as páginas, conversão de verificação pelo textutil do macOS quando
// existir). Também confere o texto PROVISÓRIO do seed da migration 0017.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAMPOS_MODELO, DATA_EM_BRANCO, dadosDeExemplo, faixaDeRascunho, renderizarModelo, rodapeDoContrato, textoDosBlocos, validarModelo, type DadosContrato } from "./contratoModelo";
import { gerarDocx } from "./docx";
import { lerZip } from "@/testes/lerZip";
import { problemasDoXml, xmllint } from "@/testes/xmlBemFormado";

const HOJE = "2026-11-21";
const dados = (extra: Partial<DadosContrato> = {}): DadosContrato => ({ ...dadosDeExemplo("pequeno_porte", HOJE), ...extra });
const SEED = /\$modelo\$([\s\S]*?)\$modelo\$/.exec(readFileSync("db/migrations/0017_fechamento.sql", "utf-8"))![1];

describe("validação do modelo (ao SALVAR)", () => {
  it("campo desconhecido e chaves soltas são erro, todos de uma vez", () => {
    expect(validarModelo("Olá {{municipio_nome}}")).toEqual({ ok: true, campos: ["municipio_nome"] });
    const r = validarModelo("{{nome_prefeito}} e {{cpf}} e {{ uf }} e {{abre sem fechar");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erros[0]).toBe("Campo(s) desconhecido(s): {{nome_prefeito}}, {{cpf}}. Use só os da lista de campos disponíveis.");
      expect(r.erros[1]).toMatch(/chaves "\{\{" ou "\}\}" soltas/);
    }
    expect(validarModelo("   ")).toMatchObject({ ok: false, erros: ["O modelo está vazio."] });
  });

  it("o modelo PROVISÓRIO do seed é válido, usa TODOS os campos e marca o que é do jurídico", () => {
    expect(validarModelo(SEED).ok).toBe(true);
    const usados = new Set([...SEED.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]));
    expect(CAMPOS_MODELO.filter((c) => !usados.has(c.campo)).map((c) => c.campo)).toEqual([]);
    expect(SEED).toContain("MODELO PROVISÓRIO");
    expect(SEED.match(/\[A SER REVISADO PELO JURÍDICO/g)!.length).toBeGreaterThanOrEqual(4);
    for (const combinado of ["data da assinatura", "períodos de 30 (trinta) dias", "aviso prévio de 30 (trinta) dias", "proporcional", "continuam devidas", "opcional", "anexo"]) {
      expect(SEED).toContain(combinado);
    }
  });
});

describe("renderização", () => {
  it("preenche os campos (CNPJ formatado, endereço completo, valores por extenso) e monta títulos, parágrafos e negrito", () => {
    const r = renderizarModelo("# Contrato\n\n## 1. Partes\n\n**CNPJ** {{cnpj}} — {{endereco_completo}}\n\n{{valor_mensal}} ({{valor_mensal_extenso}})", dados());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blocos.map((b) => b.tipo)).toEqual(["titulo", "subtitulo", "paragrafo", "paragrafo"]);
    expect(r.blocos[2].linhas[0][0]).toEqual({ texto: "CNPJ", negrito: true });
    expect(textoDosBlocos(r.blocos)).toBe(
      "Contrato\n\n1. Partes\n\nCNPJ 11.222.333/0001-81 — Rua do Exemplo, 100, Centro, Exemplópolis — PR, CEP 80000-000\n\nR$ 8.500,00 (oito mil e quinhentos reais)"
    );
  });

  it("data da assinatura por extenso; sem assinatura, linhas em branco", () => {
    const t = (d: DadosContrato) => {
      const r = renderizarModelo("{{data_assinatura}}", d);
      return r.ok ? textoDosBlocos(r.blocos) : "";
    };
    expect(t(dados())).toBe(DATA_EM_BRANCO);
    expect(t(dados({ data_assinatura: "2026-12-01" }))).toBe("1º de dezembro de 2026");
  });

  it("sem taxa (Dispensa): o PARÁGRAFO da taxa some inteiro — nunca 'R$ ()'", () => {
    const modelo = "Mensalidade {{valor_mensal}}.\n\nTaxa: {{taxa_implantacao}} ({{taxa_implantacao_extenso}}).\n\nFim.";
    const comTaxa = renderizarModelo(modelo, dados());
    const semTaxa = renderizarModelo(modelo, dados({ plano: "dispensa", taxa_implantacao_centavos: null }));
    expect(comTaxa.ok && textoDosBlocos(comTaxa.blocos)).toBe("Mensalidade R$ 8.500,00.\n\nTaxa: R$ 15.000,00 (quinze mil reais).\n\nFim.");
    expect(semTaxa.ok && textoDosBlocos(semTaxa.blocos)).toBe("Mensalidade R$ 8.500,00.\n\nFim.");
  });

  it("dado OBRIGATÓRIO faltando → erro listando EXATAMENTE quais (só os usados no texto)", () => {
    const r = renderizarModelo("{{cnpj}} {{representante_nome}} {{endereco_completo}} {{contato_telefone}} {{uf}}", dados({ cnpj: null, representante_nome: "  ", endereco_cep: null }));
    expect(r).toEqual({
      ok: false,
      faltando: ["CNPJ da prefeitura, formatado (12.345.678/0001-95)", "Endereço: logradouro, número, complemento, bairro, município — UF, CEP", "Representante legal — nome"]
    });
  });

  it("faixa de RASCUNHO só em modelo rascunho; rodapé com data e versão", () => {
    expect(faixaDeRascunho({ plano: "medio_porte", versao: 3, status: "rascunho" })).toBe("RASCUNHO — SEM VALIDADE JURÍDICA — modelo v3 do plano Médio Porte");
    expect(faixaDeRascunho({ plano: "medio_porte", versao: 3, status: "aprovado" })).toBeNull();
    expect(rodapeDoContrato({ plano: "dispensa", versao: 1, status: "aprovado" }, HOJE)).toBe("Gerado em 21/11/2026 pela plataforma NEXAIGEN, modelo Dispensa v1.");
  });
});

describe("DOCX", () => {
  const renderizado = renderizarModelo(SEED, dados({ contato_nome: 'Ana & "Beto" <teste>' }));
  if (!renderizado.ok) throw new Error("seed não renderizou");
  const rascunho = gerarDocx({ blocos: renderizado.blocos, cabecalho: faixaDeRascunho({ plano: "pequeno_porte", versao: 1, status: "rascunho" }), rodape: rodapeDoContrato({ plano: "pequeno_porte", versao: 1, status: "rascunho" }, HOJE) });
  const aprovado = gerarDocx({ blocos: renderizado.blocos, cabecalho: null, rodape: rodapeDoContrato({ plano: "pequeno_porte", versao: 2, status: "aprovado" }, HOJE) });

  it("abre como ZIP com as partes do Word; todo XML bem formado (e pelo xmllint, quando existe)", () => {
    const partes = lerZip(rascunho);
    expect(Object.keys(partes).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/footer1.xml", "word/header1.xml", "word/styles.xml"]);
    for (const [nome, xml] of Object.entries(partes)) {
      expect({ nome, problemas: problemasDoXml(xml) }).toEqual({ nome, problemas: [] });
      const lint = xmllint(xml);
      if (lint) expect({ nome, ok: lint.ok, saida: lint.saida }).toEqual({ nome, ok: true, saida: "" });
    }
    expect(partes["word/document.xml"]).toContain("Ana &amp; &quot;Beto&quot; &lt;teste&gt;"); // texto sempre escapado
    expect(partes["word/document.xml"]).toContain('<w:headerReference w:type="default" r:id="rIdCabecalho"/>');
  });

  it("rascunho: faixa no CABEÇALHO (todas as páginas) e rodapé; aprovado: sem cabeçalho", () => {
    const r = lerZip(rascunho);
    expect(r["word/header1.xml"]).toContain("RASCUNHO — SEM VALIDADE JURÍDICA — modelo v1 do plano Pequeno Porte");
    expect(r["word/footer1.xml"]).toContain("Gerado em 21/11/2026 pela plataforma NEXAIGEN, modelo Pequeno Porte v1.");
    const a = lerZip(aprovado);
    expect(a["word/header1.xml"]).toBeUndefined();
    expect(a["word/document.xml"]).not.toContain("headerReference");
    expect(a["[Content_Types].xml"]).not.toContain("header");
  });

  it("conversão de verificação por um leitor de .docx de verdade (textutil do macOS, quando existe)", () => {
    if (process.platform !== "darwin" || spawnSync("textutil", ["-help"]).error) return; // sem o conversor: a estrutura já foi validada acima
    const pasta = mkdtempSync(join(tmpdir(), "docx-"));
    try {
      writeFileSync(join(pasta, "contrato.docx"), rascunho);
      const r = spawnSync("textutil", ["-convert", "txt", "-stdout", join(pasta, "contrato.docx")], { encoding: "utf-8" });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("CONTRATO DE PRESTAÇÃO DE SERVIÇOS — MODELO PROVISÓRIO");
      expect(r.stdout).toContain("11.222.333/0001-81");
      expect(r.stdout).toContain("oito mil e quinhentos reais");
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  }, 30_000);
});
