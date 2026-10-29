"use client";

// Gestão da própria equipe NEXAIGEN — lista colegas + formulário pra
// cadastrar um novo, mostra a senha temporária UMA VEZ após cadastrar.
// Mesmo padrão de fetch client-side já usado por app/(protegido)/clientes/page.tsx
// (useEffect + fetch, sem Server Component de dados) — consistência com o
// resto do projeto, não um padrão novo.

import { useEffect, useState } from "react";

interface Colega {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  criado_em: string;
}

async function buscarColegas(): Promise<Colega[]> {
  const res = await fetch("/api/equipe");
  const data = await res.json();
  return data.colegas ?? [];
}

export default function EquipePage() {
  const [colegas, setColegas] = useState<Colega[]>([]);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ email: string; senhaTemporaria: string; aviso: string } | null>(null);

  // Recarga depois de cadastrar alguém — chamada de event handler.
  async function carregar() {
    setColegas(await buscarColegas());
  }

  // Carga inicial: estado só muda no callback da Promise (nunca de forma
  // síncrona no corpo do efeito — react-hooks/set-state-in-effect),
  // ignorado se a página desmontar antes da resposta chegar.
  useEffect(() => {
    let ativo = true;
    buscarColegas().then((lista) => {
      if (ativo) setColegas(lista);
    });
    return () => {
      ativo = false;
    };
  }, []);

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setResultado(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/equipe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome, email })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data.erro ?? "Não foi possível cadastrar o colega.");
        return;
      }
      setResultado({ email: data.email, senhaTemporaria: data.senhaTemporaria, aviso: data.aviso });
      setNome("");
      setEmail("");
      carregar();
    } catch {
      setErro("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold text-navy">Equipe NEXAIGEN</h1>

      <div className="mb-6 overflow-hidden rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-navy text-white">
            <tr>
              <th className="p-3 text-left">Nome</th>
              <th className="p-3 text-left">E-mail</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Desde</th>
            </tr>
          </thead>
          <tbody>
            {colegas.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-3">{c.nome}</td>
                <td className="p-3">{c.email}</td>
                <td className="p-3">
                  <span className={c.ativo ? "text-teal" : "text-slate-400"}>{c.ativo ? "Ativo" : "Inativo"}</span>
                </td>
                <td className="p-3">{new Date(c.criado_em).toLocaleDateString("pt-BR")}</td>
              </tr>
            ))}
            {colegas.length === 0 && (
              <tr>
                <td className="p-3 text-slate-400" colSpan={4}>
                  Nenhum colega cadastrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-semibold text-navy">Cadastrar colega novo</h2>

        {erro ? <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-alerta">{erro}</p> : null}

        {resultado ? (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Senha temporária — mostrada só desta vez</span>
              <input
                readOnly
                value={resultado.senhaTemporaria}
                className="mt-1 w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm"
              />
            </label>
            <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{resultado.aviso}</p>
            <button onClick={() => setResultado(null)} className="text-sm text-teal underline">
              Cadastrar outro colega
            </button>
          </div>
        ) : (
          <form onSubmit={cadastrar} className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Nome completo</span>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">E-mail</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={enviando}
                className="w-full rounded bg-teal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 sm:w-auto"
              >
                {enviando ? "Cadastrando..." : "Cadastrar colega"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
