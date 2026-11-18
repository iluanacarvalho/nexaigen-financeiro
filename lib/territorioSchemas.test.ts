// Schemas das rotas novas da 16-A2: lote, visão salva, entidade.

import { describe, expect, it } from "vitest";
import { LoteSchema, NovaVisaoSchema } from "./territorioSchemas";
import { EditarEntidadeSchema, EntidadeCamposSchema } from "./entidadeSchemas";
import { detalhesDoErro } from "./validacao";

describe("LoteSchema", () => {
  it("seleção com códigos válidos; não abordadas com filtros (padrão {}); chave desconhecida → erro", () => {
    expect(LoteSchema.safeParse({ acao: "previa", alvo: { modo: "selecao", codigos: ["4106902"] } }).success).toBe(true);
    expect(LoteSchema.parse({ acao: "criar", alvo: { modo: "nao_abordados" } }).alvo).toEqual({ modo: "nao_abordados", filtros: {} });
    expect(LoteSchema.safeParse({ acao: "criar", alvo: { modo: "selecao", codigos: [] } }).success).toBe(false);
    expect(LoteSchema.safeParse({ acao: "criar", alvo: { modo: "selecao", codigos: ["123"] } }).success).toBe(false);
    expect(LoteSchema.safeParse({ acao: "apagar", alvo: { modo: "selecao", codigos: ["4106902"] } }).success).toBe(false);
    expect(LoteSchema.safeParse({ acao: "criar", alvo: { modo: "selecao", codigos: ["4106902"] }, extra: 1 }).success).toBe(false);
  });
});

describe("NovaVisaoSchema", () => {
  it("só os parâmetros que a tela entende", () => {
    expect(NovaVisaoSchema.safeParse({ nome: "Pequeno porte no consórcio X", tela: "territorio", filtros: { uf: "PR", plano: "pequeno_porte" } }).success).toBe(true);
    const r = NovaVisaoSchema.safeParse({ nome: "x", tela: "entidade", filtros: { uf: "PR", pagina: "2" } });
    expect(r.success).toBe(false);
    if (!r.success) expect(detalhesDoErro(r.error).fieldErrors.filtros).toEqual(["Filtros desconhecidos para esta tela: uf, pagina."]);
    expect(NovaVisaoSchema.safeParse({ nome: "   ", tela: "leads", filtros: {} }).success).toBe(false);
  });
});

describe("EntidadeCamposSchema", () => {
  const valida = { nome: "Associação X", sigla: "", tipo: "consorcio_intermunicipal", uf: "pr", site: "", contato_nome: "", contato_email: "", contato_telefone: "", observacao: "", fonte_url: "https://x.invalid/f", verificado_em: "2026-01-01" };
  it("vazios viram null, UF em maiúscula; fonte e data obrigatórias; URL só http(s)", () => {
    expect(EntidadeCamposSchema.parse(valida)).toMatchObject({ sigla: null, uf: "PR", site: null, contato_email: null });
    const r = EntidadeCamposSchema.safeParse({ ...valida, fonte_url: "", verificado_em: "", site: "ftp://x" });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(detalhesDoErro(r.error).fieldErrors).sort()).toEqual(["fonte_url", "site", "verificado_em"]);
  });
  it("edição parcial (com ativo); vazia → erro", () => {
    expect(EditarEntidadeSchema.parse({ ativo: false })).toEqual({ ativo: false });
    expect(EditarEntidadeSchema.safeParse({}).success).toBe(false);
  });
});
