"use client";

// REGISTRAR O ACEITE DA PREFEITURA (rodada 16-B1) — 3 blocos e a prévia
// "Confira antes de confirmar". O vendedor só informa os dados DEPOIS do
// aceite; ao confirmar, o servidor faz tudo numa transação
// (POST /api/leads/[id]/aceite): lead → Ganho, cliente aguardando
// assinatura (sem cobrança), tarefa pra pessoa de Contratos. Tudo é
// validado de novo no servidor (zod estrito; CNPJ com dígito verificador).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cnpjValido, formatarCep, formatarCnpj, somenteDigitos } from "@/lib/cnpj";
import { centavosParaTextoCampo, formatarMoeda, lerValorMonetario } from "@/lib/dinheiro";
import { nomeDoCliente, textoDoQueVaiAcontecer } from "@/lib/fechamento";
import { PLANOS, rotuloDoPlano, valoresPadrao, type IdPlano } from "@/lib/planos";

export interface DadosIniciaisAceite {
  leadId: string;
  versao: number;
  municipio: { nome: string; uf: string; codigo_ibge: string | null; populacao: number | null };
  plano: IdPlano;
  /** De onde veio o plano sugerido: interesse do lead, população, ou padrão. */
  origemPlano: "interesse" | "populacao" | "padrao";
  contato: { nome: string; cargo: string; email: string; telefone: string };
}

type Campos = {
  plano: IdPlano;
  valor_mensal: string;
  taxa_implantacao: string;
  data_prevista_assinatura: string;
  cnpj: string;
  endereco_logradouro: string;
  endereco_numero: string;
  endereco_complemento: string;
  endereco_bairro: string;
  endereco_cep: string;
  representante_nome: string;
  representante_cargo: string;
  contato_nome: string;
  contato_cargo: string;
  contato_email: string;
  contato_telefone: string;
};

const ROTULOS: Record<keyof Campos, string> = {
  plano: "Plano",
  valor_mensal: "Mensalidade (R$)",
  taxa_implantacao: "Taxa de implantação (R$)",
  data_prevista_assinatura: "Data prevista de assinatura (opcional)",
  cnpj: "CNPJ da prefeitura",
  endereco_logradouro: "Logradouro",
  endereco_numero: "Número",
  endereco_complemento: "Complemento (opcional)",
  endereco_bairro: "Bairro",
  endereco_cep: "CEP",
  representante_nome: "Representante legal — nome",
  representante_cargo: "Representante legal — cargo",
  contato_nome: "Contato operacional — nome",
  contato_cargo: "Contato operacional — cargo",
  contato_email: "Contato operacional — e-mail",
  contato_telefone: "Contato operacional — telefone"
};

const OBRIGATORIOS: (keyof Campos)[] = [
  "valor_mensal", "cnpj", "endereco_logradouro", "endereco_numero", "endereco_bairro", "endereco_cep",
  "representante_nome", "representante_cargo", "contato_nome", "contato_cargo", "contato_email", "contato_telefone"
];

function precosDoPlano(plano: IdPlano) {
  const p = valoresPadrao(plano);
  return { valor_mensal: centavosParaTextoCampo(p.valorMensalCentavos), taxa_implantacao: p.taxaImplantacaoCentavos === null ? "" : centavosParaTextoCampo(p.taxaImplantacaoCentavos) };
}

/** Erros que dá pra ver antes de enviar (o servidor valida tudo de novo). */
export function errosLocais(c: Campos): Partial<Record<keyof Campos, string>> {
  const e: Partial<Record<keyof Campos, string>> = {};
  for (const k of OBRIGATORIOS) if (c[k].trim() === "") e[k] = "Obrigatório.";
  if (c.cnpj.trim() && !cnpjValido(c.cnpj)) e.cnpj = "CNPJ inválido — confira os 14 dígitos.";
  if (c.endereco_cep.trim() && somenteDigitos(c.endereco_cep).length !== 8) e.endereco_cep = "CEP com 8 dígitos.";
  if (c.valor_mensal.trim() && !lerValorMonetario(c.valor_mensal).ok) e.valor_mensal = "Valor inválido.";
  if (c.plano !== "dispensa" && c.taxa_implantacao.trim() && !lerValorMonetario(c.taxa_implantacao).ok) e.taxa_implantacao = "Valor inválido.";
  if (c.contato_email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.contato_email.trim())) e.contato_email = "E-mail inválido.";
  return e;
}

export default function FormAceite({ inicial }: { inicial: DadosIniciaisAceite }) {
  const router = useRouter();
  const [c, setC] = useState<Campos>({
    plano: inicial.plano,
    ...precosDoPlano(inicial.plano),
    data_prevista_assinatura: "",
    cnpj: "",
    endereco_logradouro: "",
    endereco_numero: "",
    endereco_complemento: "",
    endereco_bairro: "",
    endereco_cep: "",
    representante_nome: "",
    representante_cargo: "",
    contato_nome: inicial.contato.nome,
    contato_cargo: inicial.contato.cargo,
    contato_email: inicial.contato.email,
    contato_telefone: inicial.contato.telefone
  });
  const [erros, setErros] = useState<Partial<Record<keyof Campos, string>>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [previa, setPrevia] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const muda = (k: keyof Campos) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setC({ ...c, [k]: e.target.value });

  if (!inicial.municipio.codigo_ibge) {
    return (
      <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Este lead não está vinculado a um município da base (código IBGE). Vincule o município no detalhe do lead antes de registrar o aceite.{" "}
        <Link href={`/crm/${inicial.leadId}#vincular`} className="font-medium underline">
          Voltar ao lead
        </Link>
      </div>
    );
  }

  function trocarPlano(plano: IdPlano) {
    setC({ ...c, plano, ...precosDoPlano(plano) });
  }

  function conferir(e: React.FormEvent) {
    e.preventDefault();
    const locais = errosLocais(c);
    setErros(locais);
    setErroGeral(Object.keys(locais).length ? "Confira os campos destacados." : null);
    if (Object.keys(locais).length === 0) setPrevia(true);
  }

  async function confirmar() {
    setEnviando(true);
    setErroGeral(null);
    const corpo = {
      versao: inicial.versao,
      plano: c.plano,
      valor_mensal: c.valor_mensal.trim(),
      taxa_implantacao: c.plano === "dispensa" || c.taxa_implantacao.trim() === "" ? null : c.taxa_implantacao.trim(),
      data_prevista_assinatura: c.data_prevista_assinatura || null,
      cnpj: c.cnpj,
      endereco_logradouro: c.endereco_logradouro,
      endereco_numero: c.endereco_numero,
      endereco_complemento: c.endereco_complemento,
      endereco_bairro: c.endereco_bairro,
      endereco_cep: c.endereco_cep,
      representante_nome: c.representante_nome,
      representante_cargo: c.representante_cargo,
      contato_nome: c.contato_nome,
      contato_cargo: c.contato_cargo,
      contato_email: c.contato_email,
      contato_telefone: c.contato_telefone
    };
    const res = await fetch(`/api/leads/${inicial.leadId}/aceite`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    const d = await res.json().catch(() => null);
    setEnviando(false);
    if (!res.ok) {
      const campos = (d?.detalhes?.fieldErrors ?? {}) as Record<string, string[]>;
      setErros(Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v[0]])) as Partial<Record<keyof Campos, string>>);
      setErroGeral(d?.detalhes?.formErrors?.[0] ?? d?.erro ?? "Não foi possível registrar o aceite.");
      setPrevia(false);
      return;
    }
    router.push(`/crm/${inicial.leadId}?aceite=ok`);
  }

  // A mensagem de erro fica FORA do <label> (ligada por aria-describedby): o nome acessível do campo não muda depois da validação.
  const campo = (k: keyof Campos, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div key={k}>
      <label className="block">
        <span className="font-medium text-slate-700">{ROTULOS[k]}</span>
        <input
          value={c[k]}
          onChange={muda(k)}
          aria-invalid={erros[k] ? true : undefined}
          aria-describedby={erros[k] ? `erro-${k}` : undefined}
          {...extra}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
        />
      </label>
      {erros[k] && (
        <span id={`erro-${k}`} className="mt-1 block text-xs text-red-700">
          {erros[k]}
        </span>
      )}
    </div>
  );

  const valor = lerValorMonetario(c.valor_mensal);
  const taxa = c.plano === "dispensa" || c.taxa_implantacao.trim() === "" ? null : lerValorMonetario(c.taxa_implantacao);
  const m = inicial.municipio;

  if (previa) {
    const linha = (rotulo: string, v: string) => (
      <div className="flex flex-wrap gap-x-2">
        <dt className="text-slate-500">{rotulo}:</dt>
        <dd className="font-medium">{v}</dd>
      </div>
    );
    return (
      <section role="dialog" aria-label="Confira antes de confirmar" className="rounded-lg border-2 border-teal bg-white p-5 text-sm shadow">
        <h2 className="mb-3 text-lg font-bold text-navy">Confira antes de confirmar</h2>
        <dl className="grid gap-1 sm:grid-cols-2">
          {linha("Cliente", `${nomeDoCliente(m.nome)} — ${m.uf} (IBGE ${m.codigo_ibge})`)}
          {linha("Plano", rotuloDoPlano(c.plano))}
          {linha("Mensalidade", valor.ok ? formatarMoeda(valor.centavos) : c.valor_mensal)}
          {linha("Taxa de implantação", taxa === null ? "sem taxa" : taxa.ok ? formatarMoeda(taxa.centavos) : c.taxa_implantacao)}
          {linha("Assinatura prevista", c.data_prevista_assinatura ? c.data_prevista_assinatura.split("-").reverse().join("/") : "—")}
          {linha("CNPJ", formatarCnpj(c.cnpj))}
          {linha("Endereço", `${[c.endereco_logradouro, c.endereco_numero, c.endereco_complemento, c.endereco_bairro].filter(Boolean).join(", ")} — CEP ${formatarCep(c.endereco_cep)}`)}
          {linha("Representante legal", `${c.representante_nome} — ${c.representante_cargo}`)}
          {linha("Contato operacional", `${c.contato_nome} — ${c.contato_cargo} — ${c.contato_email} — ${c.contato_telefone}`)}
        </dl>
        <h3 className="mt-4 font-semibold text-navy">O que vai acontecer</h3>
        <ul className="ml-5 list-disc" aria-label="O que vai acontecer">
          {textoDoQueVaiAcontecer({ municipio: m.nome, uf: m.uf, plano: c.plano }).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        {erroGeral && (
          <p role="alert" className="mt-3 text-red-700">
            {erroGeral}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void confirmar()} disabled={enviando} className="rounded bg-teal px-4 py-2 font-semibold text-white disabled:opacity-50">
            {enviando ? "Registrando..." : "Confirmar o aceite"}
          </button>
          <button type="button" onClick={() => setPrevia(false)} className="rounded border border-slate-300 px-4 py-2">
            Voltar e corrigir
          </button>
        </div>
      </section>
    );
  }

  return (
    <form aria-label="Registrar aceite da prefeitura" onSubmit={conferir} className="space-y-5 text-sm">
      <section aria-label="1. Município" className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-semibold text-navy">1. Município</h2>
        <p data-testid="municipio-do-aceite">
          <strong>{m.nome}</strong> — {m.uf} · código IBGE {m.codigo_ibge} · {m.populacao === null ? "população não informada" : `${m.populacao.toLocaleString("pt-BR")} hab.`}
        </p>
        <p className="text-xs text-slate-500">Vem da base territorial (não editável aqui).</p>
      </section>

      <section aria-label="2. Contrato" className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm sm:grid-cols-2">
        <h2 className="font-semibold text-navy sm:col-span-2">2. Contrato</h2>
        <div>
          <label className="block">
            <span className="font-medium text-slate-700">Plano</span>
            <select value={c.plano} onChange={(e) => trocarPlano(e.target.value as IdPlano)} aria-describedby="ajuda-plano" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
              {PLANOS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.rotulo}
                </option>
              ))}
            </select>
          </label>
          <span id="ajuda-plano" className="mt-1 block text-xs text-slate-500">
            {inicial.origemPlano === "interesse" ? "Sugerido: o plano de interesse do lead." : inicial.origemPlano === "populacao" ? "Sugerido pela população do município." : "Sem sugestão — confira."} Trocar o plano repõe os valores padrão.
          </span>
        </div>
        {campo("valor_mensal", { inputMode: "decimal" })}
        {c.plano === "dispensa" ? <p className="self-end text-xs text-slate-500">Dispensa não tem taxa de implantação.</p> : campo("taxa_implantacao", { inputMode: "decimal", placeholder: "em branco = sem taxa" })}
        {campo("data_prevista_assinatura", { type: "date" })}
      </section>

      <section aria-label="3. Dados da prefeitura" className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm sm:grid-cols-2">
        <h2 className="font-semibold text-navy sm:col-span-2">3. Dados da prefeitura</h2>
        {campo("cnpj", { inputMode: "numeric", placeholder: "00.000.000/0000-00" })}
        {campo("endereco_cep", { inputMode: "numeric", placeholder: "00000-000" })}
        {campo("endereco_logradouro")}
        {campo("endereco_numero")}
        {campo("endereco_complemento")}
        {campo("endereco_bairro")}
        {campo("representante_nome")}
        {campo("representante_cargo")}
        {campo("contato_nome")}
        {campo("contato_cargo")}
        {campo("contato_email", { type: "email" })}
        {campo("contato_telefone")}
        <p className="text-xs text-slate-500 sm:col-span-2">O contato vem do lead — confira. Não informe CPF nem dados pessoais além do necessário.</p>
      </section>

      {erroGeral && (
        <p role="alert" className="text-red-700">
          {erroGeral}
        </p>
      )}
      <button type="submit" className="rounded bg-navy px-4 py-2 font-medium text-white">
        Conferir antes de confirmar
      </button>
    </form>
  );
}
