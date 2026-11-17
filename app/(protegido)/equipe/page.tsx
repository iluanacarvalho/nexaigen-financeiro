"use client";

// Gestão da própria equipe NEXAIGEN — lista colegas + formulário pra
// cadastrar um novo, mostra a senha temporária UMA VEZ após cadastrar.
// Mesmo padrão de fetch client-side já usado por app/(protegido)/clientes/page.tsx
// (useEffect + fetch, sem Server Component de dados) — consistência com o
// resto do projeto, não um padrão novo.
//
// Rodada 15-A — perfis de acesso: só admin chega aqui (layout.tsx desta
// pasta + a API). Cada colega tem um PAPEL (lib/papeis.ts); trocar o papel
// pede confirmação e encerra as sessões da pessoa (ela entra de novo já
// com o acesso novo). Se for o próprio papel, a tela manda pro /login. O
// servidor recusa (409) tirar o papel do último administrador.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PAPEIS, ROTULO_PAPEL, type Papel } from "@/lib/papeis";

interface Colega {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  criado_em: string;
}

interface MudancaPendente {
  colega: Colega;
  papel: Papel;
  erro: string | null;
  enviando: boolean;
}

/** O que cada papel enxerga — texto da tela (a regra mesmo é lib/papeis.ts). */
const DESCRICAO_PAPEL: Record<Papel, string> = {
  admin: "tudo, inclusive Equipe",
  financeiro: "clientes, notas, painel, novos contratos, checagem, alertas e dashboard",
  vendas: "ainda nenhum módulo (reservado para o CRM)",
  rh: "ainda nenhum módulo (reservado para o RH)"
};

async function buscarColegas(): Promise<Colega[]> {
  const res = await fetch("/api/equipe");
  const data = await res.json();
  return data.colegas ?? [];
}

export default function EquipePage() {
  const router = useRouter();
  const [colegas, setColegas] = useState<Colega[]>([]);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [papelNovo, setPapelNovo] = useState<Papel>("financeiro");
  const [mudanca, setMudanca] = useState<MudancaPendente | null>(null);
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
        body: JSON.stringify({ nome, email, papel: papelNovo })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data.erro ?? "Não foi possível cadastrar o colega.");
        return;
      }
      setResultado({ email: data.email, senhaTemporaria: data.senhaTemporaria, aviso: data.aviso });
      setNome("");
      setEmail("");
      setPapelNovo("financeiro");
      carregar();
    } catch {
      setErro("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarMudanca() {
    if (!mudanca) return;
    setMudanca({ ...mudanca, enviando: true, erro: null });
    const res = await fetch(`/api/equipe/${mudanca.colega.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ papel: mudanca.papel })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMudanca({ ...mudanca, enviando: false, erro: data.erro ?? "Não foi possível mudar o papel." });
      return;
    }
    // Mudou o PRÓPRIO papel: a sessão foi encerrada no servidor — entra de novo.
    if (data.sessaoEncerrada) {
      router.push("/login");
      router.refresh();
      return;
    }
    setMudanca(null);
    carregar();
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold text-navy">Equipe NEXAIGEN</h1>

      <div className="mb-6 overflow-hidden rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-navy text-white">
            <tr>
              <th className="p-3 text-left">Nome</th>
              <th className="p-3 text-left">E-mail</th>
              <th className="p-3 text-left">Papel</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Desde</th>
            </tr>
          </thead>
          <tbody>
            {colegas.map((c) => (
              <tr key={c.id} className="border-t align-top" data-testid={`colega-${c.id}`}>
                <td className="p-3">{c.nome}</td>
                <td className="p-3">{c.email}</td>
                <td className="p-3">
                  <select
                    aria-label={`Papel de ${c.nome}`}
                    value={mudanca?.colega.id === c.id ? mudanca.papel : c.papel}
                    disabled={mudanca !== null}
                    onChange={(e) => {
                      const papel = e.target.value as Papel;
                      if (papel !== c.papel) setMudanca({ colega: c, papel, erro: null, enviando: false });
                    }}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    {PAPEIS.map((p) => (
                      <option key={p} value={p}>
                        {ROTULO_PAPEL[p]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-3">
                  <span className={c.ativo ? "text-teal" : "text-slate-400"}>{c.ativo ? "Ativo" : "Inativo"}</span>
                </td>
                <td className="p-3">{new Date(c.criado_em).toLocaleDateString("pt-BR")}</td>
              </tr>
            ))}
            {colegas.length === 0 && (
              <tr>
                <td className="p-3 text-slate-400" colSpan={5}>
                  Nenhum colega cadastrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {mudanca && (
        <div role="dialog" aria-label="Confirmar mudança de papel" className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-slate-800">
            Mudar o papel de {mudanca.colega.nome} de <strong>{ROTULO_PAPEL[mudanca.colega.papel]}</strong> para <strong>{ROTULO_PAPEL[mudanca.papel]}</strong>?
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Com o papel {ROTULO_PAPEL[mudanca.papel]}, a pessoa vê: {DESCRICAO_PAPEL[mudanca.papel]}. As sessões dela são encerradas agora — ela precisa entrar de novo.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={confirmarMudanca} disabled={mudanca.enviando} className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {mudanca.enviando ? "Salvando..." : "Confirmar mudança de papel"}
            </button>
            <button type="button" onClick={() => setMudanca(null)} disabled={mudanca.enviando} className="rounded border border-slate-300 px-3 py-1.5 text-xs">
              Voltar
            </button>
          </div>
          {mudanca.erro && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {mudanca.erro}
            </p>
          )}
        </div>
      )}

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
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">Papel</span>
              <select value={papelNovo} onChange={(e) => setPapelNovo(e.target.value as Papel)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm">
                {PAPEIS.map((p) => (
                  <option key={p} value={p}>
                    {ROTULO_PAPEL[p]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-500">Vê: {DESCRICAO_PAPEL[papelNovo]}.</span>
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
