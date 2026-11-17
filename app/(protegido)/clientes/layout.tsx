// Acesso por papel (rodada 15-A): só quem tem a área "clientes" (lib/papeis.ts)
// chega nesta página; os demais são redirecionados (lib/authPagina.ts).

import { exigirAreaPagina } from "@/lib/authPagina";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await exigirAreaPagina("clientes");
  return <>{children}</>;
}
