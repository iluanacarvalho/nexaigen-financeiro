// Nova entidade intermunicipal (rodada 16-A2) — só admin (layout). Os dados
// reais de cada estado podem vir em lote por CSV (scripts/importar-entidades-csv.ts).

import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import FormEntidade from "../FormEntidade";

export default function NovaEntidadePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold text-navy">Nova entidade</h1>
      <FormEntidade hoje={hojeEmSaoPaulo(new Date())} />
    </main>
  );
}
