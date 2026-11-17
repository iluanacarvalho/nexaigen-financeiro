"use client";

// Extraído do antigo app/layout.tsx (nav estática) pra virar parte do
// shell PROTEGIDO (app/(protegido)/layout.tsx) — antes a nav aparecia
// até em /login (confuso, mostrava links pra páginas que exigem sessão
// numa tela de quem ainda não tem uma). Client Component só porque
// precisa do botão de logout (chamada de fetch).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { itensNavDoPapel, rotuloDoPapel, type Papel } from "@/lib/papeis";

// Itens por papel (rodada 15-A): só o que o papel pode acessar
// (lib/papeis.ts#itensNavDoPapel) — esconder o link é só UX; o bloqueio de
// verdade é o layout de cada página e o exigirPapel de cada rota de API.
export default function NavBar({ nome, papel }: { nome: string; papel: Papel }) {
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
    <nav aria-label="Navegação principal" className="border-b bg-white px-6 py-3">
      <div className="mx-auto flex max-w-5xl items-center gap-6 text-sm">
        <span className="font-bold text-navy">NEXAIGEN Financeiro</span>
        {itensNavDoPapel(papel).map((item) => (
          <Link key={item.href} href={item.href} className="text-slate-600 hover:text-navy">
            {item.rotulo}
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-3 text-slate-500">
          <span>
            {nome} <span className="text-xs text-slate-400">({rotuloDoPapel(papel)})</span>
          </span>
          <button onClick={sair} disabled={saindo} className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
            {saindo ? "Saindo..." : "Sair"}
          </button>
        </span>
      </div>
    </nav>
  );
}
