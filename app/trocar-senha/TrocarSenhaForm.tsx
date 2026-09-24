"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TrocarSenhaForm() {
  const router = useRouter();
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function trocar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (novaSenha !== confirmacao) {
      setErro("A confirmação não bate com a nova senha.");
      return;
    }
    setCarregando(true);
    try {
      const res = await fetch("/api/auth/trocar-senha", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senha_atual: senhaAtual, nova_senha: novaSenha })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data.erro ?? "Não foi possível trocar a senha.");
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setErro("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-navy">Defina sua senha</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sua conta foi criada por um colega com uma senha temporária. Defina uma senha só sua antes de continuar.
          </p>
        </div>

        <form onSubmit={trocar} className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
          {erro ? <p className="rounded bg-red-50 px-3 py-2 text-sm text-alerta">{erro}</p> : null}

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Senha temporária atual</span>
            <input
              type="password"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Nova senha</span>
            <input
              type="password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
            />
            <span className="mt-1 block text-xs text-slate-400">Mínimo 8 caracteres, com ao menos uma letra e um número.</span>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Confirmar nova senha</span>
            <input
              type="password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              autoComplete="new-password"
              required
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={carregando}
            className="w-full rounded bg-teal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {carregando ? "Salvando..." : "Definir senha e continuar"}
          </button>
        </form>
      </div>
    </main>
  );
}
