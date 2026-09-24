"use client";

// Login da equipe NEXAIGEN — rodada de correção de achado crítico de
// segurança (antes desta rodada, não existia login nenhum). Sem
// componente de auth existente pra reaproveitar neste projeto (diferente
// do nexaigen-educa, que já tinha um painel institucional pronto) — layout
// simples com a mesma paleta navy/teal já usada em todo o resto do app
// (tailwind.config.ts) e nos e-mails (lib/emailTemplate.ts), pra manter
// consistência visual sem introduzir nada elaborado.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, senha })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data.erro ?? "Não foi possível entrar.");
        return;
      }
      router.push(data.precisa_trocar_senha ? "/trocar-senha" : "/");
      router.refresh();
    } catch {
      // Sem este catch, uma falha de REDE (servidor fora do ar, não um
      // 4xx/5xx com corpo JSON) faz o clique não mostrar nada.
      setErro("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 inline-flex h-10 items-center rounded-md bg-navy px-4">
            <span className="text-sm font-bold tracking-wide text-white">NEXAIGEN</span>
          </div>
          <h1 className="text-xl font-bold text-navy">Financeiro</h1>
          <p className="mt-1 text-sm text-slate-500">Área interna da equipe</p>
        </div>

        <form onSubmit={entrar} className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
          {erro ? <p className="rounded bg-red-50 px-3 py-2 text-sm text-alerta">{erro}</p> : null}

          <label className="block text-sm">
            <span className="font-medium text-slate-700">E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Senha</span>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={carregando}
            className="w-full rounded bg-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {carregando ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          Contas são cadastradas por um colega já logado em /equipe — não há autocadastro.
        </p>
      </div>
    </main>
  );
}
