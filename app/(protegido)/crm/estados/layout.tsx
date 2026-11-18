// Liberar/bloquear estados: só admin (área "crm_gestao", rodada 16-A2).
import { exigirAreaPagina } from "@/lib/authPagina";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await exigirAreaPagina("crm_gestao");
  return <>{children}</>;
}
