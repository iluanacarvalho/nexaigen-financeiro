"use client";

// Extraído do antigo app/layout.tsx (nav estática) pra virar parte do
// shell PROTEGIDO (app/(protegido)/layout.tsx) — antes a nav aparecia
// até em /login (confuso, mostrava links pra páginas que exigem sessão
// numa tela de quem ainda não tem uma). Client Component só porque
// precisa do botão de logout (chamada de fetch).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NavBar({ nome }: { nome: string }) {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setSaindo(false);
    }
  }

  return (
    <nav className="border-b bg-white px-6 py-3">
      <div className="mx-auto flex max-w-5xl items-center gap-6 text-sm">
        <span className="font-bold text-navy">NEXAIGEN Financeiro</span>
        <Link href="/" className="text-slate-600 hover:text-navy">Dashboard</Link>
        <Link href="/painel" className="text-slate-600 hover:text-navy">Painel</Link>
        <Link href="/notas" className="text-slate-600 hover:text-navy">Notas fiscais</Link>
        <Link href="/checagem" className="text-slate-600 hover:text-navy">Fila de Checagem</Link>
        <Link href="/clientes" className="text-slate-600 hover:text-navy">Clientes</Link>
        <Link href="/alertas" className="text-slate-600 hover:text-navy">Alertas de Cobrança</Link>
        <Link href="/equipe" className="text-slate-600 hover:text-navy">Equipe</Link>
        <span className="ml-auto flex items-center gap-3 text-slate-500">
          <span>{nome}</span>
          <button onClick={sair} disabled={saindo} className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
            {saindo ? "Saindo..." : "Sair"}
          </button>
        </span>
      </div>
    </nav>
  );
}
