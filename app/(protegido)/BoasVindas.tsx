// Página inicial de quem ainda não tem módulos (vendas, rh — rodada 15-A).
// Nenhum dado financeiro aqui, de propósito.

const AREA_DO_PAPEL: Record<string, string> = { vendas: "vendas", rh: "RH" };

export default function BoasVindas({ nome, papel }: { nome: string; papel: string }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-3 text-2xl font-bold text-navy">Bem-vindo, {nome}</h1>
      <p className="text-slate-600">Seu acesso de {AREA_DO_PAPEL[papel] ?? papel} ainda não tem módulos.</p>
      <p className="mt-2 text-sm text-slate-500">Os módulos da sua área vão aparecer aqui quando forem liberados. Dúvidas, fale com um administrador.</p>
    </main>
  );
}
