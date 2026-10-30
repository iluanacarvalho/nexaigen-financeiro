"use client";

// Paginação simples — a paginação de verdade é no servidor (GET /api/notas
// devolve `total`); isto só troca a página pedida. Usada pela tela de
// Notas fiscais e pela Fila de Checagem.

export default function Paginacao({ pagina, porPagina, total, onMudar }: { pagina: number; porPagina: number; total: number; onMudar: (pagina: number) => void }) {
  const ultima = Math.max(1, Math.ceil(total / porPagina));
  if (total <= porPagina) return null;
  return (
    <nav aria-label="Paginação" className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>
        Página {pagina} de {ultima} · {total} {total === 1 ? "nota" : "notas"}
      </span>
      <span className="flex gap-2">
        <button type="button" onClick={() => onMudar(pagina - 1)} disabled={pagina <= 1} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">
          Anterior
        </button>
        <button type="button" onClick={() => onMudar(pagina + 1)} disabled={pagina >= ultima} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">
          Próxima
        </button>
      </span>
    </nav>
  );
}
