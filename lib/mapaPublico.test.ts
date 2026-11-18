// lib/mapaPublico.ts (elegibilidade, JSON público com EXATAMENTE as chaves
// previstas, etiqueta da listagem), lib/origensMapaPublico.ts (lista de
// origens, CORS, CSP) e lib/mapaProjecao.ts.

import { describe, expect, it } from "vitest";
import { elegivelNoMapa, montarJsonPublico, situacaoDivulgacao, type LinhaClienteMapa } from "./mapaPublico";
import { cabecalhosCors, cspDoMapa, lerOrigensMapaPublico } from "./origensMapaPublico";
import { FAIXA_VALIDA, LARGURA_MAPA, alturaDoMapa, projetar } from "./mapaProjecao";
import { MAPA_BRASIL } from "./mapaBrasil.gerado";

const HOJE = "2026-11-17";
const AGORA = new Date("2026-11-17T15:00:00Z");
const cliente = (extra: Partial<LinhaClienteMapa> = {}): LinhaClienteMapa => ({
  nome: "Prefeitura de Teste", uf: "PR", status_contrato: "ativo", cancelamento_termino_em: null,
  autorizacao_divulgacao: true, latitude: "-25.400000", longitude: "-49.200000", ...extra
});

describe("elegibilidade", () => {
  it("autorizado + posição + ativo ou em aviso prévio vigente → aparece", () => {
    expect(elegivelNoMapa(cliente(), HOJE)).toBe(true);
    expect(elegivelNoMapa(cliente({ status_contrato: "em_aviso_previo", cancelamento_termino_em: HOJE }), HOJE)).toBe(true);
  });
  it("sem autorização, sem posição, suspenso, encerrado ou aviso já vencido → não aparece", () => {
    expect(elegivelNoMapa(cliente({ autorizacao_divulgacao: false }), HOJE)).toBe(false);
    expect(elegivelNoMapa(cliente({ latitude: null, longitude: null }), HOJE)).toBe(false);
    expect(elegivelNoMapa(cliente({ status_contrato: "suspenso" }), HOJE)).toBe(false);
    expect(elegivelNoMapa(cliente({ status_contrato: "encerrado" }), HOJE)).toBe(false);
    expect(elegivelNoMapa(cliente({ status_contrato: "em_aviso_previo", cancelamento_termino_em: "2026-11-16" }), HOJE)).toBe(false);
  });
});

describe("JSON público", () => {
  it("EXATAMENTE { atualizadoEm, total, municipios: [{ nome, uf, lat, lon }] } — nada a mais, mesmo com colunas extras na linha", () => {
    const comExtras = { ...cliente(), id: "segredo", contato_email: "x@y", valor_mensal: "1", codigo_ibge: "4106902", plano: "dispensa" } as LinhaClienteMapa;
    const json = montarJsonPublico([comExtras, cliente({ nome: "Fora", autorizacao_divulgacao: false })], HOJE, AGORA);
    expect(Object.keys(json).sort()).toEqual(["atualizadoEm", "municipios", "total"]);
    expect(json).toEqual({ atualizadoEm: "2026-11-17T15:00:00.000Z", total: 1, municipios: [{ nome: "Prefeitura de Teste", uf: "PR", lat: -25.4, lon: -49.2 }] });
    expect(Object.keys(json.municipios[0]).sort()).toEqual(["lat", "lon", "nome", "uf"]);
    expect(JSON.stringify(json)).not.toMatch(/segredo|x@y|4106902|dispensa/);
  });
  it("ordenado por UF e nome; vazio → total 0", () => {
    const json = montarJsonPublico([cliente({ nome: "B", uf: "SP" }), cliente({ nome: "Z", uf: "AC" }), cliente({ nome: "A", uf: "SP" })], HOJE, AGORA);
    expect(json.municipios.map((m) => `${m.uf}/${m.nome}`)).toEqual(["AC/Z", "SP/A", "SP/B"]);
    expect(montarJsonPublico([], HOJE, AGORA)).toEqual({ atualizadoEm: AGORA.toISOString(), total: 0, municipios: [] });
  });
});

describe("etiqueta da listagem", () => {
  const c = (extra: Partial<LinhaClienteMapa & { codigo_ibge: string | null }>) => ({ ...cliente(), codigo_ibge: "4106902", ...extra });
  it.each([
    ["sem código", c({ codigo_ibge: null, latitude: null, longitude: null, autorizacao_divulgacao: false }), "sem_codigo"],
    ["código sem posição", c({ latitude: null, longitude: null, autorizacao_divulgacao: false }), "posicao_pendente"],
    ["com posição, não autorizado", c({ autorizacao_divulgacao: false }), "sem_autorizacao"],
    ["autorizado e ativo", c({}), "no_mapa"],
    ["autorizado mas encerrado", c({ status_contrato: "encerrado" }), "fora_do_mapa"]
  ] as const)("%s → %s", (_d, linha, esperado) => {
    expect(situacaoDivulgacao(linha, HOJE)).toBe(esperado);
  });
});

describe("origens (MAPA_PUBLICO_ORIGENS)", () => {
  it("lê lista separada por vírgula; descarta inválidas (sem protocolo, com caminho, curinga); deduplica; vazia = []", () => {
    expect(lerOrigensMapaPublico(" https://www.nexaigen.com.br , https://nexaigen.com.br/ ,https://www.nexaigen.com.br")).toEqual(["https://www.nexaigen.com.br", "https://nexaigen.com.br"]);
    expect(lerOrigensMapaPublico("*,nexaigen.com.br,https://x.com/pagina,ftp://x.com,https://user:senha@x.com,http://localhost:4000")).toEqual(["http://localhost:4000"]);
    expect(lerOrigensMapaPublico("")).toEqual([]);
    expect(lerOrigensMapaPublico(undefined)).toEqual([]);
  });
  it("CORS: só ecoa origem da lista (nunca *); sempre Vary: Origin", () => {
    const origens = ["https://www.nexaigen.com.br"];
    expect(cabecalhosCors("https://www.nexaigen.com.br", origens)).toEqual({ vary: "Origin", "access-control-allow-origin": "https://www.nexaigen.com.br", "access-control-allow-methods": "GET" });
    expect(cabecalhosCors("https://evil.example", origens)).toEqual({ vary: "Origin" });
    expect(cabecalhosCors(null, origens)).toEqual({ vary: "Origin" });
    expect(cabecalhosCors("https://www.nexaigen.com.br", [])).toEqual({ vary: "Origin" });
  });
  it("CSP do /mapa: nada de outro domínio; frame-ancestors = self + origens; unsafe-eval só em dev", () => {
    const csp = cspDoMapa(["https://www.nexaigen.com.br"], false);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("frame-ancestors 'self' https://www.nexaigen.com.br");
    expect(csp).not.toContain("unsafe-eval");
    expect(cspDoMapa([], false)).toContain("frame-ancestors 'self'");
    expect(cspDoMapa([], true)).toContain("'unsafe-eval'");
  });
});

describe("projeção e mapa gerado", () => {
  it("equiretangular: cantos da área viram cantos do SVG; toda a faixa válida cabe no desenho", () => {
    const l = MAPA_BRASIL.limites;
    expect(projetar(l.lonMin, l.latMax, l)).toEqual({ x: 0, y: 0 });
    const canto = projetar(l.lonMax, l.latMin, l);
    expect(canto.x).toBe(LARGURA_MAPA);
    expect(canto.y).toBeLessThanOrEqual(alturaDoMapa(l));
    expect(alturaDoMapa(l) - canto.y).toBeLessThan(1);
    for (const [lon, lat] of [[FAIXA_VALIDA.lonMin, FAIXA_VALIDA.latMin], [FAIXA_VALIDA.lonMax, FAIXA_VALIDA.latMax], [-32.42, -3.85]]) {
      const p = projetar(lon, lat, l);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(MAPA_BRASIL.largura);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(MAPA_BRASIL.altura);
    }
  });
});
