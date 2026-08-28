import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEXAIGEN Financeiro",
  description: "Controle interno de contratos, notas fiscais e cobrança"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <nav className="border-b bg-white px-6 py-3">
          <div className="mx-auto flex max-w-5xl items-center gap-6 text-sm">
            <span className="font-bold text-navy">NEXAIGEN Financeiro</span>
            <a href="/" className="text-slate-600 hover:text-navy">Dashboard</a>
            <a href="/checagem" className="text-slate-600 hover:text-navy">Fila de Checagem</a>
            <a href="/clientes" className="text-slate-600 hover:text-navy">Clientes</a>
            <a href="/alertas" className="text-slate-600 hover:text-navy">Alertas de Cobrança</a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
