import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEXAIGEN Financeiro",
  description: "Controle interno de contratos, notas fiscais e cobrança"
};

// Rodada de correção de achado crítico de segurança: a nav (com links pra
// todo dado real) morava aqui, então aparecia até em /login — movida pra
// app/NavBar.tsx, renderizada só dentro do shell protegido
// (app/(protegido)/layout.tsx). Este layout raiz fica só com o
// <html>/<body>, comum a TODAS as páginas (protegidas ou não).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
