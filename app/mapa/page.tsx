// Página PÚBLICA /mapa (rodada 15-B) — fora de app/(protegido): sem login,
// sem NavBar interna, sem cookie. Pode ser incorporada por iframe SÓ pelas
// origens de MAPA_PUBLICO_ORIGENS (frame-ancestors no proxy.ts). Nenhuma
// requisição a outro domínio: o mapa é SVG de arquivo estático e a CSP do
// proxy proíbe qualquer recurso de fora.
//
// Lê o banco direto (lib/mapaPublicoRepositorio.ts — a MESMA função do
// GET /api/publico/mapa-clientes): só nome, UF e posição de quem autorizou
// e tem contrato vigente. `connection()`: renderiza por requisição (nunca
// congelada no build — revogar a autorização tira do mapa na próxima visita).

import type { Metadata } from "next";
import { connection } from "next/server";
import { obterMapaPublico } from "@/lib/mapaPublicoRepositorio";
import MapaPublico from "./MapaPublico";

export const metadata: Metadata = {
  title: "Prefeituras atendidas — NEXAIGEN",
  description: "Mapa das prefeituras que usam a NEXAIGEN.",
  robots: { index: true, follow: false }
};

export default async function MapaPage() {
  await connection();
  return <MapaPublico dados={await obterMapaPublico()} />;
}
