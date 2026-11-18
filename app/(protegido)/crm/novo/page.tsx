// CRM — cadastro de lead (rodada 16-A). Área "crm" (layout.tsx da pasta
// pai). Admin escolhe o vendedor (lista de quem pode ser vendedor); vendas
// cria sempre pra si — o servidor garante (lib/crmServico.ts#criarLead).

import { redirect } from "next/navigation";
import { contextoDaPagina } from "@/lib/authPagina";
import { listarVendedores } from "@/lib/crmRepositorio";
import FormNovoLead from "./FormNovoLead";

export default async function NovoLeadPage() {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  const admin = contexto.papel === "admin";
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold text-navy">Novo lead</h1>
      <FormNovoLead admin={admin} vendedores={admin ? await listarVendedores() : []} eu={contexto.equipeId} />
    </main>
  );
}
