// Mapa das prefeituras atendidas (rodada 15-B) — SVG próprio, sem
// biblioteca, sem tiles de terceiros, sem fontes externas: contornos dos
// estados do arquivo estático lib/mapaBrasil.gerado.ts e um ponto por
// município, na MESMA projeção (lib/mapaProjecao.ts). Nome e UF aparecem
// ao passar o mouse ou tocar/focar o ponto (só CSS — sem JavaScript de
// interação), e a lista textual abaixo do mapa dá o mesmo conteúdo pra
// leitor de tela. Recebe só o JSON público (nome, UF, posição).

import { MAPA_BRASIL } from "@/lib/mapaBrasil.gerado";
import { projetar } from "@/lib/mapaProjecao";
import type { JsonMapaPublico } from "@/lib/mapaPublico";

export default function MapaPublico({ dados }: { dados: JsonMapaPublico }) {
  const { largura, altura, limites, estados } = MAPA_BRASIL;
  const total = dados.total;
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 text-slate-800">
      <h1 className="mb-1 text-2xl font-bold text-navy">Prefeituras que usam a NEXAIGEN</h1>
      <p className="mb-4 text-lg">{total === 0 ? "Em breve, as primeiras prefeituras" : `${total} ${total === 1 ? "prefeitura atendida" : "prefeituras atendidas"}`}</p>

      <svg viewBox={`0 0 ${largura} ${altura}`} className="h-auto w-full" role="img" aria-labelledby="titulo-mapa">
        <title id="titulo-mapa">{total === 0 ? "Mapa do Brasil" : `Mapa do Brasil com ${total} ${total === 1 ? "prefeitura atendida" : "prefeituras atendidas"}`}</title>
        <g aria-hidden="true">
          {estados.map((e) => (
            <path key={e.uf} d={e.d} fill="#e2e8f0" stroke="#ffffff" strokeWidth={1.2} strokeLinejoin="round" />
          ))}
        </g>
        {dados.municipios.map((m) => {
          const { x, y } = projetar(m.lon, m.lat, limites);
          const rotulo = `${m.nome} — ${m.uf}`;
          const aEsquerda = x > largura * 0.7;
          return (
            <g key={`${m.uf}-${m.nome}`} tabIndex={0} aria-label={rotulo} className="group cursor-pointer outline-none" data-testid="ponto-municipio">
              <title>{rotulo}</title>
              <circle cx={x} cy={y} r={14} fill="transparent" />
              <circle cx={x} cy={y} r={6} fill="#0f766e" stroke="#ffffff" strokeWidth={2} className="group-hover:fill-[#1F3864] group-focus:fill-[#1F3864]" />
              <text
                x={aEsquerda ? x - 12 : x + 12}
                y={y - 10}
                textAnchor={aEsquerda ? "end" : "start"}
                fontSize={18}
                fill="#1F3864"
                stroke="#ffffff"
                strokeWidth={4}
                paintOrder="stroke"
                className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus:opacity-100"
              >
                {rotulo}
              </text>
            </g>
          );
        })}
      </svg>

      {total > 0 && (
        <section aria-labelledby="titulo-lista" className="mt-6">
          <h2 id="titulo-lista" className="mb-2 font-semibold text-navy">
            Lista de prefeituras atendidas
          </h2>
          <ul className="columns-1 gap-6 text-sm sm:columns-2">
            {dados.municipios.map((m) => (
              <li key={`${m.uf}-${m.nome}`}>
                {m.nome} — {m.uf}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-6 text-xs text-slate-500">Posição aproximada do município. Aparecem só as prefeituras que autorizaram a divulgação. Contornos: IBGE.</p>
    </main>
  );
}
