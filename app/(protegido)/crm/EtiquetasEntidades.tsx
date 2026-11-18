// Etiquetas das entidades (associações, consórcios) a que o município
// pertence (rodada 16-A2) — clicáveis, com "N prefeituras desta entidade
// já são clientes" (argumento de venda). Usadas na linha do Território, na
// tela da entidade e no detalhe do lead.

import Link from "next/link";
import { textoClientesNaEtiqueta, type EntidadeEtiqueta } from "@/lib/territorio";

export default function EtiquetasEntidades({ entidades }: { entidades: EntidadeEtiqueta[] }) {
  if (entidades.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1" aria-label="Entidades">
      {entidades.map((e) => (
        <li key={e.id}>
          <Link href={`/crm/entidades/${e.id}`} className="inline-block rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-900 hover:underline" data-testid="etiqueta-entidade">
            {e.sigla ?? e.nome} · {textoClientesNaEtiqueta(e.clientes)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
