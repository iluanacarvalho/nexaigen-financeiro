// Modelos de contrato (rodada 16-B1) — só admin (layout). Server Component:
// lê as versões direto (lib/modelosContratoServico.ts) e entrega à tela.
import { CAMPOS_MODELO } from "@/lib/contratoModelo";
import { listarModelos } from "@/lib/modelosContratoServico";
import TelaModelos from "./TelaModelos";

export default async function ModelosContratoPage() {
  const modelos = await listarModelos();
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-navy">Modelos de contrato</h1>
      <p className="mb-4 text-sm text-slate-600">
        Um modelo por plano. Editar cria uma versão NOVA em rascunho (as anteriores nunca mudam). Enquanto não houver versão aprovada, o contrato gerado sai com a faixa
        &quot;RASCUNHO — SEM VALIDADE JURÍDICA&quot;.
      </p>
      <TelaModelos modelos={modelos} campos={[...CAMPOS_MODELO]} />
    </main>
  );
}
