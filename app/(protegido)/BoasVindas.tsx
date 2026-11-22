// Página inicial de quem não tem o Dashboard financeiro (vendas, rh —
// rodada 15-A). Nenhum dado financeiro aqui, de propósito. Desde a rodada
// 16-A, vendas tem o CRM: a página aponta pra lá. Desde a 16-B1, Contratos
// e Implantação veem as tarefas abertas e atrasadas do papel.

import Link from "next/link";

export default function BoasVindas({ nome, papel, tarefas = null }: { nome: string; papel: string; tarefas?: { abertas: number; atrasadas: number; minhas: number } | null }) {
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
      ) : tarefas ? (
        <>
          <p className="text-slate-600">
            {papel === "contratos"
              ? "Seu trabalho: gerar o contrato de cada prefeitura que aceitou, colher a assinatura e registrar a data e o PDF assinado."
              : "Seu trabalho: implantar a plataforma nas prefeituras que já assinaram o contrato."}
          </p>
          <p className="mt-3 text-lg" data-testid="contagem-inicio">
            <strong>{tarefas.abertas}</strong> {tarefas.abertas === 1 ? "tarefa aberta" : "tarefas abertas"} ·{" "}
            <strong className={tarefas.atrasadas > 0 ? "text-red-700" : ""}>{tarefas.atrasadas}</strong> {tarefas.atrasadas === 1 ? "atrasada" : "atrasadas"}
          </p>
          <Link href="/operacao" className="mt-4 inline-block rounded bg-navy px-4 py-2 text-sm font-medium text-white">
            Abrir as tarefas
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
