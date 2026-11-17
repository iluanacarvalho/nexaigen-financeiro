// Página inicial (rodada 15-A) — existe pra TODO papel. Quem tem acesso ao
// Dashboard financeiro (admin, financeiro — lib/papeis.ts) vê o Dashboard;
// vendas e rh (reservados pro CRM e pro RH) veem só as boas-vindas, sem
// nenhum dado financeiro. É também o destino dos redirects de página por
// falta de acesso (lib/authPagina.ts).

import { redirect } from "next/navigation";
import { contextoDaPagina } from "@/lib/authPagina";
import { podeAcessar } from "@/lib/papeis";
import BoasVindas from "./BoasVindas";
import Dashboard from "./Dashboard";

export default async function Inicio() {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  if (podeAcessar(contexto.papel, "dashboard")) return <Dashboard />;
  return <BoasVindas nome={contexto.nome} papel={contexto.papel} />;
}
