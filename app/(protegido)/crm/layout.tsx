// Acesso por papel (rodada 16-A): só quem tem a área "crm" (admin e vendas,
// lib/papeis.ts) chega no CRM; financeiro e rh são redirecionados
// (lib/authPagina.ts). A visibilidade de CADA lead (vendas só os seus) é
// garantida no SQL (lib/crmRepositorio.ts), não aqui.

import { exigirAreaPagina } from "@/lib/authPagina";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await exigirAreaPagina("crm");
  return <>{children}</>;
}
