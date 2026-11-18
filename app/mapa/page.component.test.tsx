// Página pública /mapa (rodada 15-B): estado vazio honesto, pontos com nome
// e UF (título SVG + rótulo no hover/foco), lista textual acessível, e
// NENHUMA referência a outro domínio no HTML (sem tiles, fontes, scripts
// ou imagens de fora). Server Component: leitura do banco mockada.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mapaMock } = vi.hoisted(() => ({ mapaMock: vi.fn() }));
vi.mock("@/lib/mapaPublicoRepositorio", () => ({ obterMapaPublico: mapaMock }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: vi.fn(async () => undefined) }));

import MapaPage from "./page";

const COM_PONTOS = {
  atualizadoEm: "2026-11-17T15:00:00.000Z",
  total: 2,
  municipios: [
    { nome: "Prefeitura de Curitiba", uf: "PR", lat: -25.477891, lon: -49.288233 },
    { nome: "Prefeitura de São Paulo", uf: "SP", lat: -23.650049, lon: -46.648086 }
  ]
};

function semDominioExterno() {
  const html = document.body.innerHTML;
  expect(html).not.toMatch(/https?:\/\//);
  expect(document.querySelectorAll("img, link, script, iframe")).toHaveLength(0);
}

describe("/mapa — página pública", () => {
  it("vazio: 'Em breve, as primeiras prefeituras', mapa desenhado, sem erro e sem lista", async () => {
    mapaMock.mockResolvedValue({ atualizadoEm: "2026-11-17T15:00:00.000Z", total: 0, municipios: [] });
    render(await MapaPage());
    expect(screen.getByText("Em breve, as primeiras prefeituras")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Mapa do Brasil" })).toBeTruthy();
    expect(document.querySelectorAll("path")).toHaveLength(27);
    expect(screen.queryAllByTestId("ponto-municipio")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Lista de prefeituras atendidas" })).toBeNull();
    semDominioExterno();
  });

  it("com pontos: 'N prefeituras atendidas', um ponto focável por município com nome e UF, lista textual igual", async () => {
    mapaMock.mockResolvedValue(COM_PONTOS);
    render(await MapaPage());
    expect(screen.getByText("2 prefeituras atendidas")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Mapa do Brasil com 2 prefeituras atendidas" })).toBeTruthy();

    const pontos = screen.getAllByRole("button");
    expect(pontos.map((p) => p.getAttribute("aria-label"))).toEqual(["Prefeitura de Curitiba — PR", "Prefeitura de São Paulo — SP"]);
    for (const p of pontos) {
      expect(p.getAttribute("tabindex")).toBe("0"); // tocar/teclado também mostra o nome
      expect(p.querySelector("title")!.textContent).toBe(p.getAttribute("aria-label"));
      const [x, y] = [Number(p.querySelector("circle")!.getAttribute("cx")), Number(p.querySelector("circle")!.getAttribute("cy"))];
      expect(x).toBeGreaterThan(0);
      expect(y).toBeGreaterThan(0);
    }
    const lista = screen.getByRole("region", { name: "Lista de prefeituras atendidas" });
    expect(within(lista).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Prefeitura de Curitiba — PR", "Prefeitura de São Paulo — SP"]);
    semDominioExterno();
  });

  it("um município: singular", async () => {
    mapaMock.mockResolvedValue({ ...COM_PONTOS, total: 1, municipios: COM_PONTOS.municipios.slice(0, 1) });
    render(await MapaPage());
    expect(screen.getByText("1 prefeitura atendida")).toBeTruthy();
  });

  describe("toque/clique e teclado (rodada 15-C)", () => {
    const rotuloVisivel = () => screen.queryAllByTestId("rotulo-ponto").filter((r) => r.getAttribute("data-visivel") === "sim").map((r) => r.textContent);

    it("tocar abre o rótulo; tocar em outro troca; tocar de novo no mesmo fecha; tocar fora fecha", async () => {
      mapaMock.mockResolvedValue(COM_PONTOS);
      const usuario = userEvent.setup();
      render(await MapaPage());
      const [curitiba, saoPaulo] = screen.getAllByRole("button");
      expect(rotuloVisivel()).toEqual([]);

      await usuario.click(curitiba);
      expect(rotuloVisivel()).toEqual(["Prefeitura de Curitiba — PR"]);
      expect(curitiba.getAttribute("aria-pressed")).toBe("true");

      await usuario.click(saoPaulo);
      expect(rotuloVisivel()).toEqual(["Prefeitura de São Paulo — SP"]);
      expect(curitiba.getAttribute("aria-pressed")).toBe("false");

      await usuario.click(saoPaulo);
      expect(rotuloVisivel()).toEqual([]);

      await usuario.click(curitiba);
      await usuario.click(screen.getByRole("heading", { name: "Prefeituras que usam a NEXAIGEN" })); // fora de qualquer ponto
      expect(rotuloVisivel()).toEqual([]);

      await usuario.click(saoPaulo);
      fireEvent.click(document.querySelector("path")!); // tocar no contorno de um estado também é "fora"
      expect(rotuloVisivel()).toEqual([]);
    });

    it("teclado: Tab chega no ponto, Enter abre, Espaço troca pro outro, Esc fecha", async () => {
      mapaMock.mockResolvedValue(COM_PONTOS);
      const usuario = userEvent.setup();
      render(await MapaPage());
      await usuario.tab();
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Prefeitura de Curitiba — PR");
      await usuario.keyboard("{Enter}");
      expect(rotuloVisivel()).toEqual(["Prefeitura de Curitiba — PR"]);
      await usuario.tab();
      await usuario.keyboard(" ");
      expect(rotuloVisivel()).toEqual(["Prefeitura de São Paulo — SP"]);
      await usuario.keyboard("{Escape}");
      expect(rotuloVisivel()).toEqual([]);
    });

    it("hover e foco continuam mostrando o rótulo (CSS group-hover/group-focus) mesmo sem nada aberto", async () => {
      mapaMock.mockResolvedValue(COM_PONTOS);
      render(await MapaPage());
      for (const rotulo of screen.getAllByTestId("rotulo-ponto")) {
        expect(rotulo.getAttribute("class")).toContain("group-hover:opacity-100");
        expect(rotulo.getAttribute("class")).toContain("group-focus:opacity-100");
      }
      expect(screen.getByRole("region", { name: "Lista de prefeituras atendidas" })).toBeTruthy();
    });
  });
});
