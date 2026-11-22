// Modelos de contrato (rodada 16-B1): só admin (área "modelos_contrato").
import { exigirAreaPagina } from "@/lib/authPagina";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await exigirAreaPagina("modelos_contrato");
  return <>{children}</>;
}
