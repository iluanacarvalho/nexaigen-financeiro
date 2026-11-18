"use client";

// Cadastro/edição de entidade intermunicipal (rodada 16-A2) — só admin.
// Fonte (endereço de onde a informação foi conferida) e data da verificação
// são OBRIGATÓRIAS; verificação com mais de 12 meses ganha aviso.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROTULO_TIPO_ENTIDADE, TIPOS_ENTIDADE, UFS_BRASIL, verificacaoAntiga } from "@/lib/entidades";

export interface DadosFormEntidade {
  id?: string;
  nome: string;
  sigla: string | null;
  tipo: string;
  uf: string | null;
  site: string | null;
  contato_nome: string | null;
  contato_email: string | null;
  contato_telefone: string | null;
  observacao: string | null;
  fonte_url: string;
  verificado_em: string;
  ativo?: boolean;
}

const VAZIA: DadosFormEntidade = { nome: "", sigla: null, tipo: "associacao_municipios", uf: "PR", site: null, contato_nome: null, contato_email: null, contato_telefone: null, observacao: null, fonte_url: "", verificado_em: "" };

export default function FormEntidade({ inicial, hoje }: { inicial?: DadosFormEntidade; hoje: string }) {
  const router = useRouter();
  const [d, setD] = useState<DadosFormEntidade>(inicial ?? VAZIA);
  const [erro, setErro] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [ok, setOk] = useState(false);
  const editando = !!inicial?.id;
  const muda = (campo: keyof DadosFormEntidade) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD({ ...d, [campo]: e.target.value });

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setErros({});
    setOk(false);
    const corpo = {
      nome: d.nome,
      sigla: d.sigla ?? "",
      tipo: d.tipo,
      uf: d.uf ?? "",
      site: d.site ?? "",
      contato_nome: d.contato_nome ?? "",
      contato_email: d.contato_email ?? "",
      contato_telefone: d.contato_telefone ?? "",
      observacao: d.observacao ?? "",
      fonte_url: d.fonte_url,
      verificado_em: d.verificado_em
    };
    const res = await fetch(editando ? `/api/entidades/${inicial!.id}` : "/api/entidades", { method: editando ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    const resposta = await res.json().catch(() => null);
    if (!res.ok) {
      setErro(resposta?.erro ?? "Não foi possível salvar.");
      setErros(resposta?.detalhes?.fieldErrors ?? {});
      return;
    }
    if (editando) {
      setOk(true);
      router.refresh();
    } else router.push(`/crm/entidades/${resposta.id}`);
  }

  async function alternarAtivo() {
    const res = await fetch(`/api/entidades/${inicial!.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ativo: !inicial!.ativo }) });
    if (res.ok) router.refresh();
  }

  const campo = (rotulo: string, nome: keyof DadosFormEntidade, extra: { obrigatorio?: boolean; tipo?: string; max?: number } = {}) => (
    <label className="block">
      <span className="font-medium text-slate-700">
        {rotulo}
        {extra.obrigatorio && " *"}
      </span>
      <input
        type={extra.tipo ?? "text"}
        value={(d[nome] as string | null) ?? ""}
        onChange={muda(nome)}
        required={extra.obrigatorio}
        maxLength={extra.max}
        aria-invalid={erros[nome] ? true : undefined}
        className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
      />
      {erros[nome] && <span className="text-xs text-red-700">{erros[nome].join(" ")}</span>}
    </label>
  );

  return (
    <form onSubmit={salvar} aria-label={editando ? "Editar entidade" : "Nova entidade"} className="grid gap-3 rounded-lg border bg-white p-4 text-sm shadow-sm sm:grid-cols-2">
      {campo("Nome", "nome", { obrigatorio: true, max: 200 })}
      {campo("Sigla", "sigla", { max: 30 })}
      <label className="block">
        <span className="font-medium text-slate-700">Tipo *</span>
        <select value={d.tipo} onChange={muda("tipo")} className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5">
          {TIPOS_ENTIDADE.map((t) => (
            <option key={t} value={t}>
              {ROTULO_TIPO_ENTIDADE[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="font-medium text-slate-700">UF</span>
        <select value={d.uf ?? ""} onChange={muda("uf")} className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5">
          <option value="">Várias / nacional</option>
          {UFS_BRASIL.map((uf) => (
            <option key={uf} value={uf}>
              {uf}
            </option>
          ))}
        </select>
      </label>
      {campo("Site", "site", { max: 300 })}
      {campo("Contato (nome)", "contato_nome", { max: 200 })}
      {campo("Contato (e-mail)", "contato_email", { tipo: "email", max: 254 })}
      {campo("Contato (telefone)", "contato_telefone", { max: 40 })}
      {campo("Fonte (endereço onde a informação foi conferida)", "fonte_url", { obrigatorio: true, max: 500 })}
      {campo("Data da verificação", "verificado_em", { obrigatorio: true, tipo: "date" })}
      {d.verificado_em && verificacaoAntiga(d.verificado_em, hoje) && <p className="text-xs text-amber-700 sm:col-span-2">Verificação com mais de 12 meses — confira a fonte de novo.</p>}
      <label className="block sm:col-span-2">
        <span className="font-medium text-slate-700">Observação</span>
        <textarea value={d.observacao ?? ""} onChange={muda("observacao")} maxLength={1000} rows={2} className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5" />
      </label>
      {erro && (
        <p role="alert" className="text-red-700 sm:col-span-2">
          {erro}
        </p>
      )}
      {ok && (
        <p role="status" className="text-emerald-700 sm:col-span-2">
          Entidade salva.
        </p>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" className="rounded bg-navy px-4 py-2 text-white">
          {editando ? "Salvar alterações" : "Cadastrar entidade"}
        </button>
        {editando && (
          <button type="button" onClick={alternarAtivo} className="rounded border border-slate-300 px-4 py-2">
            {inicial!.ativo ? "Desativar entidade" : "Reativar entidade"}
          </button>
        )}
      </div>
    </form>
  );
}
