// Acesso por papel (rodada 16-A): só quem tem a área "crm" (admin e vendas,
// lib/papeis.ts) chega no CRM; financeiro e rh são redirecionados
// (lib/authPagina.ts). A visibilidade de CADA lead (vendas só os seus) é
// garantida no SQL (lib/crmRepositorio.ts), não aqui. Desde a 16-A2, a
// navegação do CRM (Leads · Território · Entidades · Estados) e a busca
// global ficam aqui.

import { exigirAreaPagina } from "@/lib/authPagina";
import NavCrm from "./NavCrm";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const contexto = await exigirAreaPagina("crm");
  return (
    <>
      <NavCrm admin={contexto.papel === "admin"} />
      {children}
    </>
  );
}
