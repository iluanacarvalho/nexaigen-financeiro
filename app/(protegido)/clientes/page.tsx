"use client";

// Contrato em PDF COM histórico de versões (0009) desde a rodada 08 — o
// mesmo componente do PDF da nota fiscal (components/PdfVersionado.tsx):
// versão atual, download por link real, confirmação ao substituir ("a
// versão anterior será mantida") e histórico.

import { useEffect, useState } from "react";
import PdfVersionado from "@/components/PdfVersionado";
import type { ClientePrefeitura } from "@/lib/tipos";

async function buscarClientes(): Promise<ClientePrefeitura[]> {
  const res = await fetch("/api/clientes");
  const data = await res.json();
  return data.clientes ?? [];
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState<ClientePrefeitura[]>([]);
  const [mostrarForm, setMostrarForm] = useState(false);
  // null = criando um cliente novo; um cliente = editando (PATCH /api/clientes/[id]).
  const [editando, setEditando] = useState<ClientePrefeitura | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);

  // Recarga depois de salvar/anexar — chamada de event handler.
  async function carregar() {
    setClientes(await buscarClientes());
  }

  // Carga inicial: estado só muda no callback da Promise (nunca de forma
  // síncrona no corpo do efeito — react-hooks/set-state-in-effect), ignorado
  // se a página desmontar antes. `?editar=<id>` (link "cadastro do cliente"
  // do Painel Financeiro) já abre o formulário de edição desse cliente.
  useEffect(() => {
    let ativo = true;
    const idParaEditar = new URLSearchParams(window.location.search).get("editar");
    buscarClientes().then((lista) => {
      if (!ativo) return;
      setClientes(lista);
      const alvo = idParaEditar ? lista.find((c) => c.id === idParaEditar) : undefined;
      if (alvo) {
        setEditando(alvo);
        setMostrarForm(true);
      }
    });
    return () => {
      ativo = false;
    };
  }, []);

  function abrirForm(cliente: ClientePrefeitura | null) {
    setErroForm(null);
    setEditando(cliente);
    setMostrarForm(true);
  }

  async function salvar(formData: FormData) {
    setErroForm(null);
    const corpo = {
      nome: formData.get("nome"),
      uf: formData.get("uf"),
      plano: formData.get("plano"),
      valor_mensal: Number(formData.get("valor_mensal")),
      dia_vencimento_contrato: Number(formData.get("dia_vencimento_contrato") || 1),
      data_inicio_contrato: formData.get("data_inicio_contrato"),
      sistema_portal: formData.get("sistema_portal") || undefined,
      portal_url: formData.get("portal_url") || undefined,
      contato_email: formData.get("contato_email") || undefined,
      // Na edição, string vazia limpa a observação (PATCH grava null); na criação, só omite.
      observacao: editando ? String(formData.get("observacao") ?? "") : formData.get("observacao") || undefined
    };
    const res = await fetch(editando ? `/api/clientes/${editando.id}` : "/api/clientes", {
      method: editando ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo)
    });
    if (!res.ok) {
      setErroForm("Não foi possível salvar — confira os campos e tente novamente.");
      return;
    }
    setMostrarForm(false);
    setEditando(null);
    carregar();
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">Prefeituras Clientes</h1>
        <button
          onClick={() => (mostrarForm ? setMostrarForm(false) : abrirForm(null))}
          className="rounded bg-navy px-4 py-2 text-sm text-white"
        >
          {mostrarForm ? "Cancelar" : "+ Novo cliente"}
        </button>
      </div>

      {mostrarForm && (
        // key: remonta o form (inputs não-controlados) ao trocar entre criar/editar clientes diferentes.
        <form key={editando?.id ?? "novo"} action={salvar} className="mb-6 grid gap-3 rounded-lg border bg-white p-6 shadow-sm sm:grid-cols-2">
          <h2 className="font-semibold text-navy sm:col-span-2">{editando ? `Editar — ${editando.nome}` : "Novo cliente"}</h2>
          <Campo label="Nome da prefeitura" name="nome" required valor={editando?.nome} />
          <Campo label="UF" name="uf" required valor={editando?.uf} />
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Plano</span>
            <select name="plano" defaultValue={editando?.plano ?? "essencial"} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm">
              <option value="essencial">Essencial</option>
              <option value="completo">Completo</option>
            </select>
          </label>
          <Campo label="Valor mensal (R$)" name="valor_mensal" type="number" required valor={editando?.valor_mensal} />
          <Campo label="Dia de vencimento do contrato" name="dia_vencimento_contrato" type="number" valor={editando?.dia_vencimento_contrato} />
          <Campo label="Data de início do contrato" name="data_inicio_contrato" type="date" required valor={editando?.data_inicio_contrato} />
          <Campo label="Sistema do portal (ex.: Betha)" name="sistema_portal" valor={editando?.sistema_portal} />
          <Campo label="URL do portal" name="portal_url" valor={editando?.portal_url} />
          <Campo label="E-mail de contato" name="contato_email" type="email" valor={editando?.contato_email} />
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Observação</span>
            <textarea
              name="observacao"
              rows={3}
              defaultValue={editando?.observacao ?? ""}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
            />
          </label>
          {erroForm && <p className="text-sm text-red-600 sm:col-span-2">{erroForm}</p>}
          <div className="sm:col-span-2">
            <button type="submit" className="w-full rounded bg-teal px-4 py-2 text-sm font-medium text-white">
              {editando ? "Salvar alterações" : "Salvar cliente"}
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
              <th className="p-3 text-left">Contrato</th>
              <th className="p-3 text-left"></th>
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
                <td className="p-3">
                  <PdfVersionado
                    urlArquivo={`/api/clientes/${c.id}/contrato`}
                    rotulo="contrato"
                    versaoAtual={c.contrato_versao_atual ?? null}
                    nomeAtual={c.contrato_arquivo_nome}
                    onEnviado={() => carregar()}
                  />
                </td>
                <td className="p-3">
                  <button onClick={() => abrirForm(c)} className="text-xs text-navy underline">
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Campo({
  label,
  name,
  type = "text",
  required = false,
  valor
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  valor?: string | number | null;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={valor ?? undefined}
        step={type === "number" ? "any" : undefined}
        className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
      />
    </label>
  );
}
