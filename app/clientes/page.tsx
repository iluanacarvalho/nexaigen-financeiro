"use client";

import { useEffect, useState } from "react";

export default function ClientesPage() {
  const [clientes, setClientes] = useState<any[]>([]);
  const [mostrarForm, setMostrarForm] = useState(false);

  async function carregar() {
    const res = await fetch("/api/clientes");
    const data = await res.json();
    setClientes(data.clientes ?? []);
  }

  useEffect(() => {
    carregar();
  }, []);

  async function salvar(formData: FormData) {
    await fetch("/api/clientes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nome: formData.get("nome"),
        uf: formData.get("uf"),
        plano: formData.get("plano"),
        valor_mensal: Number(formData.get("valor_mensal")),
        dia_vencimento_contrato: Number(formData.get("dia_vencimento_contrato") || 1),
        data_inicio_contrato: formData.get("data_inicio_contrato"),
        sistema_portal: formData.get("sistema_portal"),
        portal_url: formData.get("portal_url") || undefined,
        contato_email: formData.get("contato_email") || undefined
      })
    });
    setMostrarForm(false);
    carregar();
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">Prefeituras Clientes</h1>
        <button onClick={() => setMostrarForm(!mostrarForm)} className="rounded bg-navy px-4 py-2 text-sm text-white">
          {mostrarForm ? "Cancelar" : "+ Novo cliente"}
        </button>
      </div>

      {mostrarForm && (
        <form action={salvar} className="mb-6 grid gap-3 rounded-lg border bg-white p-6 shadow-sm sm:grid-cols-2">
          <Campo label="Nome da prefeitura" name="nome" required />
          <Campo label="UF" name="uf" required />
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Plano</span>
            <select name="plano" className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm">
              <option value="essencial">Essencial</option>
              <option value="completo">Completo</option>
            </select>
          </label>
          <Campo label="Valor mensal (R$)" name="valor_mensal" type="number" required />
          <Campo label="Dia de vencimento do contrato" name="dia_vencimento_contrato" type="number" />
          <Campo label="Data de início do contrato" name="data_inicio_contrato" type="date" required />
          <Campo label="Sistema do portal (ex.: Betha)" name="sistema_portal" />
          <Campo label="URL do portal" name="portal_url" />
          <Campo label="E-mail de contato" name="contato_email" type="email" />
          <div className="sm:col-span-2">
            <button type="submit" className="w-full rounded bg-teal px-4 py-2 text-sm font-medium text-white">
              Salvar cliente
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-navy text-white">
            <tr>
              <th className="p-3 text-left">Prefeitura</th>
              <th className="p-3 text-left">Plano</th>
              <th className="p-3 text-left">Mensalidade</th>
              <th className="p-3 text-left">Sistema do portal</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-3">
                  {c.nome} — {c.uf}
                </td>
                <td className="p-3 capitalize">{c.plano}</td>
                <td className="p-3">
                  {Number(c.valor_mensal).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </td>
                <td className="p-3">{c.sistema_portal ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Campo({ label, name, type = "text", required = false }: { label: string; name: string; type?: string; required?: boolean }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
      />
    </label>
  );
}
