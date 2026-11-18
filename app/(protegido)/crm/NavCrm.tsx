"use client";

// Navegação do CRM (rodada 16-A2): Leads · Território · Entidades · (admin)
// Estados, e a BUSCA GLOBAL: nome de entidade abre a entidade direto; nome de
// município abre a linha dele no Território.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Resultado {
  entidades: { id: string; nome: string; sigla: string | null }[];
  municipios: { codigo_ibge: string; nome: string; uf: string }[];
}

export const hrefMunicipioNoTerritorio = (m: { codigo_ibge: string; nome: string; uf: string }) => `/crm/territorio?uf=${m.uf}&busca=${encodeURIComponent(m.nome)}#m-${m.codigo_ibge}`;

export default function NavCrm({ admin }: { admin: boolean }) {
  const caminho = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    let ativo = true;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/crm/busca?q=${encodeURIComponent(q.trim())}`);
      if (ativo && res.ok) setResultado(await res.json());
    }, 250);
    return () => {
      ativo = false;
      clearTimeout(t);
    };
  }, [q]);

  const itens = [
    { href: "/crm", rotulo: "Leads" },
    { href: "/crm/territorio", rotulo: "Território" },
    { href: "/crm/entidades", rotulo: "Entidades" },
    ...(admin ? [{ href: "/crm/estados", rotulo: "Estados" }] : [])
  ];
  const ativo = (href: string) => (href === "/crm" ? caminho === "/crm" || /^\/crm\/(?!territorio|entidades|estados)/.test(caminho ?? "") : caminho?.startsWith(href));

  // Menos de 2 letras: nada aparece (o resultado antigo fica guardado, mas escondido).
  const visivel = q.trim().length >= 2 ? resultado : null;

  function abrirPrimeiro(e: React.FormEvent) {
    e.preventDefault();
    const resultado = visivel;
    if (!resultado) return;
    if (resultado.entidades.length >= 1) router.push(`/crm/entidades/${resultado.entidades[0].id}`);
    else if (resultado.municipios.length >= 1) router.push(hrefMunicipioNoTerritorio(resultado.municipios[0]));
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-3 px-4 pt-4">
      <nav aria-label="CRM" className="flex flex-wrap gap-1 text-sm">
        {itens.map((i) => (
          <Link key={i.href} href={i.href} aria-current={ativo(i.href) ? "page" : undefined} className={`rounded px-3 py-1 ${ativo(i.href) ? "bg-navy text-white" : "border border-slate-300 text-navy"}`}>
            {i.rotulo}
          </Link>
        ))}
      </nav>
      <form role="search" aria-label="Busca no CRM" onSubmit={abrirPrimeiro} className="relative w-full max-w-sm text-sm">
        <label className="sr-only" htmlFor="busca-crm">
          Buscar entidade ou município
        </label>
        <input id="busca-crm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar entidade ou município…" maxLength={60} className="w-full rounded border border-slate-300 px-3 py-1.5" />
        {visivel && (
          <div className="absolute z-10 mt-1 w-full rounded border bg-white p-2 shadow">
            {visivel.entidades.length === 0 && visivel.municipios.length === 0 ? (
              <p className="text-slate-500">Nada encontrado.</p>
            ) : (
              <ul aria-label="Resultados da busca">
                {visivel.entidades.map((e) => (
                  <li key={e.id}>
                    <Link href={`/crm/entidades/${e.id}`} className="block rounded px-1 py-0.5 hover:bg-slate-100">
                      <span className="text-[11px] text-violet-800">Entidade</span> {e.sigla ? `${e.sigla} — ` : ""}
                      {e.nome}
                    </Link>
                  </li>
                ))}
                {visivel.municipios.map((m) => (
                  <li key={m.codigo_ibge}>
                    <a href={hrefMunicipioNoTerritorio(m)} className="block rounded px-1 py-0.5 hover:bg-slate-100">
                      <span className="text-[11px] text-slate-500">Município</span> {m.nome} — {m.uf}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
