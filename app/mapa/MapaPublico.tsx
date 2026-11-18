// Mapa das prefeituras atendidas (rodada 15-B) — SVG próprio, sem
// biblioteca, sem tiles de terceiros, sem fontes externas: contornos dos
// estados do arquivo estático lib/mapaBrasil.gerado.ts (desenhados AQUI, no
// servidor) e um ponto por município, na MESMA projeção
// (lib/mapaProjecao.ts). Os pontos são a única parte interativa
// (./PontosDoMapa.tsx — toque/clique/teclado abrem o rótulo; rodada 15-C);
// a lista textual abaixo do mapa dá o mesmo conteúdo pra leitor de tela.
// Recebe só o JSON público (nome, UF, posição).

import { MAPA_BRASIL } from "@/lib/mapaBrasil.gerado";
import { projetar } from "@/lib/mapaProjecao";
import type { JsonMapaPublico } from "@/lib/mapaPublico";
import PontosDoMapa, { type PontoProjetado } from "./PontosDoMapa";

export default function MapaPublico({ dados }: { dados: JsonMapaPublico }) {
  const { largura, altura, limites, estados } = MAPA_BRASIL;
  const total = dados.total;
  const pontos: PontoProjetado[] = dados.municipios.map((m) => {
    const { x, y } = projetar(m.lon, m.lat, limites);
    return { chave: `${m.uf}-${m.nome}`, rotulo: `${m.nome} — ${m.uf}`, x, y, rotuloAEsquerda: x > largura * 0.7 };
  });
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 text-slate-800">
      <h1 className="mb-1 text-2xl font-bold text-navy">Prefeituras que usam a NEXAIGEN</h1>
      <p className="mb-4 text-lg">{total === 0 ? "Em breve, as primeiras prefeituras" : `${total} ${total === 1 ? "prefeitura atendida" : "prefeituras atendidas"}`}</p>

      {/* role="group", não "img": "img" esconderia do leitor de tela os pontos, que são botões. */}
      <svg viewBox={`0 0 ${largura} ${altura}`} className="h-auto w-full" role="group" aria-labelledby="titulo-mapa">
        <title id="titulo-mapa">{total === 0 ? "Mapa do Brasil" : `Mapa do Brasil com ${total} ${total === 1 ? "prefeitura atendida" : "prefeituras atendidas"}`}</title>
        <g aria-hidden="true">
          {estados.map((e) => (
            <path key={e.uf} d={e.d} fill="#e2e8f0" stroke="#ffffff" strokeWidth={1.2} strokeLinejoin="round" />
          ))}
        </g>
        <PontosDoMapa pontos={pontos} />
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
      <p className="mt-6 text-xs text-slate-500">Toque ou clique num ponto para ver o nome. Posição aproximada do município. Aparecem só as prefeituras que autorizaram a divulgação. Contornos: IBGE.</p>
    </main>
  );
}
