// Tarefas (rodada 16-B1): área "operacao" — Contratos, Implantação e admin
// (lib/papeis.ts). Cada pessoa vê só as tarefas do seu papel (no SQL).
import { exigirAreaPagina } from "@/lib/authPagina";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await exigirAreaPagina("operacao");
  return <>{children}</>;
}
