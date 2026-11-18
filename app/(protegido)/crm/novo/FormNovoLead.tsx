"use client";

// Cadastro de lead (rodada 16-A). Enquanto a pessoa digita município + UF,
// consulta GET /api/leads/consulta (só campos mínimos) e, se já existe lead
// ABERTO desse município (nome sem acento/caixa igual, mesma UF), mostra "já
// está com <vendedor>, etapa <etapa>" e BLOQUEIA o envio — o servidor
// recusa de novo (409) com o mesmo texto. Escolher o plano preenche o valor
// estimado com a mensalidade padrão do plano (lib/planos.ts) — editável.
// Admin escolhe o vendedor; vendas cria sempre pra si.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { centavosParaTextoCampo } from "@/lib/dinheiro";
import { ORIGENS, ROTULO_ORIGEM, etapaAberta, valorSugeridoCentavos } from "@/lib/crm";
import { UF_POR_CODIGO, nomeDeMunicipioNormalizado } from "@/lib/ibge";
import { PLANOS, type IdPlano } from "@/lib/planos";
import { consultar, textoJaExiste, type ResultadoConsulta } from "../ConsultaLead";

const UFS = Object.values(UF_POR_CODIGO).sort();

export default function FormNovoLead({ admin, vendedores, eu }: { admin: boolean; vendedores: { id: string; nome: string }[]; eu: string }) {
  const router = useRouter();
  const [municipio, setMunicipio] = useState("");
  const [uf, setUf] = useState("");
  const [plano, setPlano] = useState<IdPlano | "">("");
  const [valor, setValor] = useState("");
  const [duplicado, setDuplicado] = useState<ResultadoConsulta | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Duplicidade em tempo real: só conta lead ABERTO com o MESMO nome normalizado e a mesma UF.
  useEffect(() => {
    const nome = municipio.trim();
    if (nome.length < 2 || !uf) return;
    let ativo = true;
    const espera = setTimeout(() => {
      consultar(nome, uf).then((resultados) => {
        if (!ativo) return;
        const chave = nomeDeMunicipioNormalizado(nome);
        setDuplicado(resultados.find((r) => etapaAberta(r.etapa) && nomeDeMunicipioNormalizado(r.municipio_nome) === chave) ?? null);
      });
    }, 300);
    return () => {
      ativo = false;
      clearTimeout(espera);
    };
  }, [municipio, uf]);

  function escolherPlano(novo: IdPlano | "") {
    setPlano(novo);
    // Sugestão: a mensalidade padrão do plano — continua editável.
    if (novo && valor.trim() === "") setValor(centavosParaTextoCampo(valorSugeridoCentavos(novo)));
  }

  const bloqueado = duplicado !== null && municipio.trim().length >= 2 && !!uf;

  async function enviar(form: HTMLFormElement) {
    const fd = new FormData(form);
    const texto = (k: string) => String(fd.get(k) ?? "").trim();
    setErros({});
    setErroGeral(null);
    setEnviando(true);
    const populacao = texto("populacao");
    const corpo = {
      municipio_nome: municipio,
      uf,
      codigo_ibge: texto("codigo_ibge") || null,
      populacao: populacao === "" ? null : Number(populacao),
      plano_interesse: plano || null,
      valor_mensal_estimado: valor.trim() === "" ? null : valor.trim(),
      contato_nome: texto("contato_nome") || null,
      contato_cargo: texto("contato_cargo") || null,
      contato_email: texto("contato_email") || null,
      contato_telefone: texto("contato_telefone") || null,
      origem: texto("origem"),
      proxima_acao_em: texto("proxima_acao_em") || null,
      proxima_acao_descricao: texto("proxima_acao_descricao") || null,
      ...(admin && texto("vendedor_id") ? { vendedor_id: texto("vendedor_id") } : {})
    };
    const res = await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    const d = await res.json().catch(() => null);
    setEnviando(false);
    if (!res.ok) {
      const campos = d?.detalhes?.fieldErrors ?? {};
      setErros(Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, Array.isArray(v) ? String(v[0]) : String(v)])));
      setErroGeral(d?.detalhes?.formErrors?.[0] ?? d?.erro ?? "Não foi possível cadastrar o lead.");
      return;
    }
    router.push(`/crm/${d.id}`);
  }

  const campo = (rotulo: string, nome: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="font-medium text-slate-700">{rotulo}</span>
      <input name={nome} {...extra} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
      {erros[nome] && <span className="mt-1 block text-xs text-red-600">{erros[nome]}</span>}
    </label>
  );

  return (
    <form
      aria-label="Novo lead"
      className="grid gap-3 rounded-lg border bg-white p-6 text-sm shadow-sm sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!bloqueado) enviar(e.currentTarget);
      }}
    >
      <label className="block">
        <span className="font-medium text-slate-700">Município</span>
        <input value={municipio} onChange={(e) => setMunicipio(e.target.value)} required maxLength={200} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
        {erros.municipio_nome && <span className="mt-1 block text-xs text-red-600">{erros.municipio_nome}</span>}
      </label>
      <label className="block">
        <span className="font-medium text-slate-700">UF</span>
        <select value={uf} onChange={(e) => setUf(e.target.value)} required className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
          <option value="">Selecione…</option>
          {UFS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      {bloqueado && (
        <p role="alert" className="rounded bg-amber-50 px-3 py-2 text-amber-900 sm:col-span-2">
          {textoJaExiste(duplicado!)} {duplicado!.meu_lead ? "É um lead seu." : "Fale com o vendedor ou peça o lead se estiver parado."}
        </p>
      )}
      {campo("Código IBGE (7 dígitos, opcional)", "codigo_ibge", { inputMode: "numeric", maxLength: 7, pattern: "[0-9]{7}" })}
      {campo("População (opcional)", "populacao", { type: "number", min: 0 })}
      <label className="block">
        <span className="font-medium text-slate-700">Plano de interesse</span>
        <select value={plano} onChange={(e) => escolherPlano(e.target.value as IdPlano | "")} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
          <option value="">Ainda não sabe</option>
          {PLANOS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.rotulo}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="font-medium text-slate-700">Valor mensal estimado (R$)</span>
        <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
        <span className="mt-1 block text-xs text-slate-500">Escolher o plano sugere a mensalidade padrão — pode alterar.</span>
        {erros.valor_mensal_estimado && <span className="mt-1 block text-xs text-red-600">{erros.valor_mensal_estimado}</span>}
      </label>
      <label className="block">
        <span className="font-medium text-slate-700">Origem</span>
        <select name="origem" required defaultValue="" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
          <option value="" disabled>
            Selecione…
          </option>
          {ORIGENS.map((o) => (
            <option key={o} value={o}>
              {ROTULO_ORIGEM[o]}
            </option>
          ))}
        </select>
      </label>
      {admin && (
        <label className="block">
          <span className="font-medium text-slate-700">Vendedor</span>
          <select name="vendedor_id" defaultValue={eu} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nome}
              </option>
            ))}
          </select>
        </label>
      )}
      {campo("Contato na prefeitura", "contato_nome", { maxLength: 200 })}
      {campo("Cargo", "contato_cargo", { maxLength: 120 })}
      {campo("E-mail do contato", "contato_email", { type: "email", maxLength: 254 })}
      {campo("Telefone do contato", "contato_telefone", { maxLength: 40 })}
      {campo("Próxima ação (data)", "proxima_acao_em", { type: "date" })}
      {campo("Próxima ação (o quê)", "proxima_acao_descricao", { maxLength: 300 })}
      <div className="sm:col-span-2">
        {erroGeral && (
          <p role="alert" className="mb-2 text-red-600">
            {erroGeral}
          </p>
        )}
        <button type="submit" disabled={enviando || bloqueado} className="w-full rounded bg-teal px-4 py-2 font-medium text-white disabled:opacity-50">
          {enviando ? "Salvando..." : "Cadastrar lead"}
        </button>
      </div>
    </form>
  );
}
