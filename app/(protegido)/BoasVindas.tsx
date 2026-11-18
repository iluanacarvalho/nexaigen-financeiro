// Página inicial de quem não tem o Dashboard financeiro (vendas, rh —
// rodada 15-A). Nenhum dado financeiro aqui, de propósito. Desde a rodada
// 16-A, vendas tem o CRM: a página aponta pra lá.

import Link from "next/link";

export default function BoasVindas({ nome, papel }: { nome: string; papel: string }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-3 text-2xl font-bold text-navy">Bem-vindo, {nome}</h1>
      {papel === "vendas" ? (
        <>
          <p className="text-slate-600">Seu acesso de vendas tem o CRM: o funil das prefeituras que você está prospectando, com histórico e próximas ações.</p>
          <Link href="/crm" className="mt-4 inline-block rounded bg-navy px-4 py-2 text-sm font-medium text-white">
            Abrir o CRM
          </Link>
        </>
      ) : (
        <>
          <p className="text-slate-600">Seu acesso de {papel === "rh" ? "RH" : papel} ainda não tem módulos.</p>
          <p className="mt-2 text-sm text-slate-500">Os módulos da sua área vão aparecer aqui quando forem liberados. Dúvidas, fale com um administrador.</p>
        </>
      )}
    </main>
  );
}
