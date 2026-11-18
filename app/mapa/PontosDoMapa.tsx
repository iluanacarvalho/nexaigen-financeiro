"use client";

// Camada INTERATIVA do mapa público (rodada 15-C): os pontos dos
// municípios. Os contornos dos estados continuam desenhados no servidor
// (./MapaPublico.tsx) — só esta parte vai pro navegador, com as posições
// já projetadas (nenhum dado além de nome, UF e x/y).
//
// TOQUE EXPLÍCITO (antes dependia do navegador transformar toque em
// hover/foco): tocar/clicar num ponto — ou Enter/Espaço nele pelo teclado
// — abre o rótulo "Nome — UF"; tocar em outro ponto troca; tocar de novo
// no mesmo fecha; tocar fora de um ponto ou Esc fecha. Hover e foco por
// teclado continuam mostrando o rótulo (CSS), e a lista textual da página
// continua sendo o caminho do leitor de tela.

import { useEffect, useState } from "react";

export interface PontoProjetado {
  chave: string;
  rotulo: string;
  x: number;
  y: number;
  /** Ponto perto da borda direita: rótulo à esquerda do ponto (não sai do desenho). */
  rotuloAEsquerda: boolean;
}

export default function PontosDoMapa({ pontos }: { pontos: PontoProjetado[] }) {
  const [aberto, setAberto] = useState<string | null>(null);

  // Fechar: toque/clique fora de qualquer ponto, ou Esc. Só escuta enquanto há rótulo aberto.
  useEffect(() => {
    if (aberto === null) return;
    const aoClicar = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-ponto]")) setAberto(null);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(null);
    };
    document.addEventListener("click", aoClicar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("click", aoClicar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  const alternar = (chave: string) => setAberto((atual) => (atual === chave ? null : chave));

  return (
    <g>
      {pontos.map((p) => {
        const estaAberto = aberto === p.chave;
        return (
          <g
            key={p.chave}
            data-ponto
            data-testid="ponto-municipio"
            role="button"
            tabIndex={0}
            aria-label={p.rotulo}
            aria-pressed={estaAberto}
            className="group cursor-pointer outline-none"
            onClick={() => alternar(p.chave)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                alternar(p.chave);
              }
            }}
          >
            <title>{p.rotulo}</title>
            {/* Área de toque maior que o ponto visível (dedo ≠ cursor). */}
            <circle cx={p.x} cy={p.y} r={16} fill="transparent" />
            <circle
              cx={p.x}
              cy={p.y}
              r={6}
              stroke="#ffffff"
              strokeWidth={2}
              className={estaAberto ? "fill-[#1F3864]" : "fill-[#0f766e] group-hover:fill-[#1F3864] group-focus:fill-[#1F3864]"}
            />
            <text
              x={p.rotuloAEsquerda ? p.x - 12 : p.x + 12}
              y={p.y - 10}
              textAnchor={p.rotuloAEsquerda ? "end" : "start"}
              fontSize={18}
              fill="#1F3864"
              stroke="#ffffff"
              strokeWidth={4}
              paintOrder="stroke"
              aria-hidden="true"
              data-testid="rotulo-ponto"
              data-visivel={estaAberto ? "sim" : undefined}
              className={`pointer-events-none ${estaAberto ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus:opacity-100"}`}
            >
              {p.rotulo}
            </text>
          </g>
        );
      })}
    </g>
  );
}
