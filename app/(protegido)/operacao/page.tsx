// Tarefas de Contratos e Implantação (rodada 16-B1). A área "operacao" é
// checada no layout; as tarefas vêm de GET /api/operacao/tarefas (escopo do papel no SQL).
import { redirect } from "next/navigation";
import { contextoDaPagina } from "@/lib/authPagina";
import { rotuloDoPapel } from "@/lib/papeis";
import TelaTarefas from "./TelaTarefas";

export default async function OperacaoPage() {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-navy">Tarefas</h1>
      <p className="mb-4 text-sm text-slate-600">
        {contexto.papel === "admin" ? "Tarefas de Contratos e de Implantação." : `Tarefas do papel ${rotuloDoPapel(contexto.papel)}.`}
      </p>
      <TelaTarefas admin={contexto.papel === "admin"} papel={contexto.papel} />
    </main>
  );
}
