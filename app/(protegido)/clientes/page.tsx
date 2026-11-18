"use client";

// Prefeituras clientes — cadastro, edição, contrato em PDF com versões
// (components/PdfVersionado.tsx) e, desde a rodada 11-A, o PLANO por porte
// de município (lib/planos.ts): ao escolher o plano, "Valor mensal" (e,
// nos 3 portes, "Taxa de implantação e treinamento") são PREENCHIDOS com o
// padrão do plano e continuam editáveis — o valor combinado pode ser
// outro. Num cliente já cadastrado, trocar de plano só repõe os padrões
// depois de uma confirmação explícita. O plano não limita funcionalidade
// nenhuma: muda só o preço.
//
// Rodada 12-A — cancelamento com aviso prévio: selo do status do contrato
// (rótulos em português), "Registrar cancelamento" (data do ofício +
// motivo, confirmação mostrando o término calculado), "Retratar
// cancelamento" (confirmação) e o aviso "Contrato em aviso prévio —
// término em …" com o botão "Criar nota final" (./CancelamentoContrato.tsx
// e components/AvisoPrevio.tsx).
//
// Rodada 15-B — mapa público: coluna "Mapa público" (No mapa / Sem
// autorização / Sem código IBGE / Posição pendente / fora do mapa) e, na
// edição do cliente, a seção "Divulgação pública" (./DivulgacaoPublica.tsx).

import { Fragment, useEffect, useState } from "react";
import PdfVersionado from "@/components/PdfVersionado";
import SeloStatusContrato from "@/components/SeloStatusContrato";
import { AvisoContrato } from "@/components/AvisoPrevio";
import { PainelRegistrarCancelamento, PainelRetratarCancelamento, acoesDeCancelamento } from "./CancelamentoContrato";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import { ROTULO_SITUACAO_DIVULGACAO, situacaoDivulgacao, type SituacaoDivulgacao } from "@/lib/mapaPublico";
import DivulgacaoPublica from "./DivulgacaoPublica";
import { centavosParaTextoCampo, formatarMoeda, paraCentavos } from "@/lib/dinheiro";
import { PLANOS, obterPlano, rotuloDoPlano, temImplantacaoACobrar, valoresPadrao, type IdPlano } from "@/lib/planos";
import type { ClientePrefeitura } from "@/lib/tipos";

async function buscarClientes(): Promise<ClientePrefeitura[]> {
  const res = await fetch("/api/clientes");
  const data = await res.json();
  return data.clientes ?? [];
}

interface DadosForm {
  nome: string;
  uf: string;
  plano: IdPlano;
  valorMensal: string;
  taxaImplantacao: string;
  diaVencimento: string;
  dataInicio: string;
  sistemaPortal: string;
  portalUrl: string;
  contatoEmail: string;
  observacao: string;
}

function padroesDoPlano(plano: IdPlano): Pick<DadosForm, "valorMensal" | "taxaImplantacao"> {
  const p = valoresPadrao(plano);
  return { valorMensal: centavosParaTextoCampo(p.valorMensalCentavos), taxaImplantacao: p.taxaImplantacaoCentavos === null ? "" : centavosParaTextoCampo(p.taxaImplantacaoCentavos) };
}

function formDoCliente(c: ClientePrefeitura | null): DadosForm {
  if (!c) {
    return { nome: "", uf: "", plano: "dispensa", ...padroesDoPlano("dispensa"), diaVencimento: "1", dataInicio: "", sistemaPortal: "", portalUrl: "", contatoEmail: "", observacao: "" };
  }
  return {
    nome: c.nome,
    uf: c.uf,
    plano: c.plano,
    valorMensal: centavosParaTextoCampo(paraCentavos(c.valor_mensal)),
    taxaImplantacao: c.taxa_implantacao === null ? "" : centavosParaTextoCampo(paraCentavos(c.taxa_implantacao)),
    diaVencimento: String(c.dia_vencimento_contrato),
    dataInicio: c.data_inicio_contrato,
    sistemaPortal: c.sistema_portal ?? "",
    portalUrl: c.portal_url ?? "",
    contatoEmail: c.contato_email ?? "",
    observacao: c.observacao ?? ""
  };
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState<ClientePrefeitura[]>([]);
  const [mostrarForm, setMostrarForm] = useState(false);
  // null = criando um cliente novo; um cliente = editando (PATCH /api/clientes/[id]).
  const [editando, setEditando] = useState<ClientePrefeitura | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  // Diálogo de cancelamento aberto (um por vez, logo abaixo da linha do cliente).
  const [cancelamento, setCancelamento] = useState<{ clienteId: string; acao: "registrar" | "retratar" } | null>(null);
  const hoje = hojeEmSaoPaulo(new Date());

  async function carregar() {
    setClientes(await buscarClientes());
  }

  // Carga inicial: estado só muda no callback da Promise (react-hooks/set-state-in-effect).
  // `?editar=<id>` (link "cadastro do cliente" do Painel) já abre a edição desse cliente.
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

  async function salvar(dados: DadosForm) {
    setErroForm(null);
    const temTaxa = obterPlano(dados.plano).taxaImplantacaoCentavos !== null;
    const corpo = {
      nome: dados.nome,
      uf: dados.uf,
      plano: dados.plano,
      valor_mensal: dados.valorMensal.trim(),
      // Dispensa nunca tem taxa (o servidor recusa) — na edição manda null, pra limpar a taxa ao mudar pra Dispensa.
      taxa_implantacao: temTaxa ? (dados.taxaImplantacao.trim() === "" ? null : dados.taxaImplantacao.trim()) : editando ? null : undefined,
      dia_vencimento_contrato: Number(dados.diaVencimento || 1),
      data_inicio_contrato: dados.dataInicio,
      sistema_portal: dados.sistemaPortal || undefined,
      portal_url: dados.portalUrl || undefined,
      contato_email: dados.contatoEmail || undefined,
      // Na edição, string vazia limpa a observação (PATCH grava null); na criação, só omite.
      observacao: editando ? dados.observacao : dados.observacao || undefined
    };
    const res = await fetch(editando ? `/api/clientes/${editando.id}` : "/api/clientes", {
      method: editando ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo)
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      const detalhe = d?.detalhes ? [...(d.detalhes.formErrors ?? []), ...Object.values(d.detalhes.fieldErrors ?? {}).flat()].join(" ") : "";
      setErroForm(`Não foi possível salvar — confira os campos e tente novamente.${detalhe ? ` (${detalhe})` : ""}`);
      return;
    }
    setMostrarForm(false);
    setEditando(null);
    carregar();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">Prefeituras Clientes</h1>
        <button onClick={() => (mostrarForm ? setMostrarForm(false) : abrirForm(null))} className="rounded bg-navy px-4 py-2 text-sm text-white">
          {mostrarForm ? "Cancelar" : "+ Novo cliente"}
        </button>
      </div>

      {mostrarForm && (
        // key: remonta o formulário (estado inicial) ao trocar entre criar/editar clientes diferentes.
        <FormCliente key={editando?.id ?? "novo"} cliente={editando} erro={erroForm} onSalvar={salvar} />
      )}
      {mostrarForm && editando && (
        // Rodada 15-B: mapa público — `clientes.find` pra refletir o estado salvo depois de cada ação.
        <DivulgacaoPublica key={`divulgacao-${editando.id}`} cliente={clientes.find((c) => c.id === editando.id) ?? editando} onAlterado={carregar} />
      )}

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-navy text-white">
            <tr>
              <th className="p-3 text-left">Prefeitura</th>
              <th className="p-3 text-left">Plano</th>
              <th className="p-3 text-left">Mensalidade</th>
              <th className="p-3 text-left">Sistema do portal</th>
              <th className="p-3 text-left">Contrato</th>
              <th className="p-3 text-left">Mapa público</th>
              <th className="p-3 text-left"></th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => {
              const acoes = acoesDeCancelamento(c, hoje);
              const dialogo = cancelamento?.clienteId === c.id ? cancelamento.acao : null;
              const fechar = () => setCancelamento(null);
              const concluir = () => {
                setCancelamento(null);
                carregar();
              };
              return (
                <Fragment key={c.id}>
                  <tr className="border-t align-top" data-testid={`cliente-${c.id}`}>
                    <td className="p-3">
                      <span className="mr-2">
                        {c.nome} — {c.uf}
                      </span>
                      <SeloStatusContrato status={c.status_contrato} />
                      <AvisoContrato cliente={c} />
                      {temImplantacaoACobrar(c) && (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Implantação a cobrar — {formatarMoeda(paraCentavos(c.taxa_implantacao!))}
                          </span>
                          <a href={`/notas?implantacao=${c.id}`} className="text-xs text-navy underline">
                            Criar nota de implantação
                          </a>
                        </div>
                      )}
                    </td>
                    <td className="p-3">{rotuloDoPlano(c.plano)}</td>
                    <td className="p-3">{formatarMoeda(paraCentavos(c.valor_mensal))}</td>
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
                      <EtiquetaMapa situacao={situacaoDivulgacao(c, hoje)} />
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col items-start gap-1">
                        <button onClick={() => abrirForm(c)} className="text-xs text-navy underline">
                          Editar
                        </button>
                        {acoes.registrar && (
                          <button onClick={() => setCancelamento({ clienteId: c.id, acao: "registrar" })} disabled={cancelamento !== null} className="text-xs text-red-700 underline disabled:opacity-50">
                            Registrar cancelamento
                          </button>
                        )}
                        {acoes.retratar && (
                          <button onClick={() => setCancelamento({ clienteId: c.id, acao: "retratar" })} disabled={cancelamento !== null} className="text-xs text-navy underline disabled:opacity-50">
                            Retratar cancelamento
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {dialogo && (
                    <tr>
                      <td colSpan={7} className="bg-amber-50 p-3">
                        {dialogo === "registrar" ? (
                          <PainelRegistrarCancelamento cliente={c} onConcluido={concluir} onDesistir={fechar} />
                        ) : (
                          <PainelRetratarCancelamento cliente={c} onConcluido={concluir} onDesistir={fechar} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function FormCliente({ cliente, erro, onSalvar }: { cliente: ClientePrefeitura | null; erro: string | null; onSalvar: (d: DadosForm) => void }) {
  const [dados, setDados] = useState<DadosForm>(() => formDoCliente(cliente));
  // Cliente existente: a troca de plano fica PENDENTE até a pessoa confirmar que quer os padrões do plano novo.
  const [planoPendente, setPlanoPendente] = useState<IdPlano | null>(null);
  const plano = obterPlano(dados.plano);
  const alterar = (campos: Partial<DadosForm>) => setDados((d) => ({ ...d, ...campos }));

  function escolherPlano(novo: IdPlano) {
    if (novo === dados.plano) return;
    if (cliente) setPlanoPendente(novo);
    else alterar({ plano: novo, ...padroesDoPlano(novo) });
  }

  return (
    <form
      aria-label={cliente ? "Editar cliente" : "Novo cliente"}
      onSubmit={(e) => {
        e.preventDefault();
        onSalvar(dados);
      }}
      className="mb-6 grid gap-3 rounded-lg border bg-white p-6 shadow-sm sm:grid-cols-2"
    >
      <h2 className="font-semibold text-navy sm:col-span-2">{cliente ? `Editar — ${cliente.nome}` : "Novo cliente"}</h2>
      <CampoTexto rotulo="Nome da prefeitura" valor={dados.nome} onMudar={(v) => alterar({ nome: v })} obrigatorio />
      <CampoTexto rotulo="UF" valor={dados.uf} onMudar={(v) => alterar({ uf: v })} obrigatorio />

      <label className="block text-sm">
        <span className="font-medium text-slate-700">Plano</span>
        <select
          value={planoPendente ?? dados.plano}
          onChange={(e) => escolherPlano(e.target.value as IdPlano)}
          disabled={planoPendente !== null}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        >
          {PLANOS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.rotulo}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-slate-500">Todos os planos dão acesso a tudo — muda só o preço.</span>
      </label>

      <label className="block text-sm">
        <span className="font-medium text-slate-700">Valor mensal (R$)</span>
        <input
          value={dados.valorMensal}
          onChange={(e) => alterar({ valorMensal: e.target.value })}
          inputMode="decimal"
          required
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
        />
        <span className="mt-1 block text-xs text-slate-500">Valor padrão do plano: {formatarMoeda(plano.valorMensalCentavos)} — você pode alterar.</span>
      </label>

      {planoPendente && (
        <div role="dialog" aria-label="Confirmar troca de plano" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm sm:col-span-2">
          <p className="text-slate-800">
            Trocar o plano de <strong>{plano.rotulo}</strong> para <strong>{rotuloDoPlano(planoPendente)}</strong>? A mensalidade passa para o padrão do novo plano (
            {formatarMoeda(valoresPadrao(planoPendente).valorMensalCentavos)})
            {valoresPadrao(planoPendente).taxaImplantacaoCentavos === null
              ? " e a taxa de implantação deixa de existir (o plano Dispensa não tem implantação)."
              : ` e a taxa de implantação para ${formatarMoeda(valoresPadrao(planoPendente).taxaImplantacaoCentavos)}.`}{" "}
            Você ainda pode ajustar os valores antes de salvar.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                alterar({ plano: planoPendente, ...padroesDoPlano(planoPendente) });
                setPlanoPendente(null);
              }}
              className="rounded bg-teal px-3 py-1 text-xs font-medium text-white"
            >
              Confirmar troca de plano
            </button>
            <button type="button" onClick={() => setPlanoPendente(null)} className="rounded border border-slate-300 px-3 py-1 text-xs">
              Manter o plano atual
            </button>
          </div>
        </div>
      )}

      {/* Desde a 16-A2 todo plano tem faixa de população (inclusive a Dispensa); a taxa de implantação continua só nos 3 portes. */}
      <section aria-label="Porte do município" className="rounded border border-slate-200 bg-slate-50 p-3 text-sm sm:col-span-2">
        <p className="font-medium text-navy">
          {plano.rotulo} — {plano.faixaHabitantes}
        </p>
        {plano.taxaImplantacaoCentavos !== null && (
          <label className="mt-2 block">
            <span className="font-medium text-slate-700">Taxa de implantação e treinamento (R$)</span>
            <input
              value={dados.taxaImplantacao}
              onChange={(e) => alterar({ taxaImplantacao: e.target.value })}
              inputMode="decimal"
              className="mt-1 w-full max-w-xs rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal focus:outline-none"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Valor padrão do plano: {formatarMoeda(plano.taxaImplantacaoCentavos)} — você pode alterar (em branco = sem implantação). Cobrada uma única vez, por uma nota
              de implantação criada em Notas fiscais.
            </span>
          </label>
        )}
      </section>

      <CampoTexto rotulo="Dia de vencimento do contrato" tipo="number" valor={dados.diaVencimento} onMudar={(v) => alterar({ diaVencimento: v })} />
      <CampoTexto rotulo="Data de início do contrato" tipo="date" valor={dados.dataInicio} onMudar={(v) => alterar({ dataInicio: v })} obrigatorio />
      <CampoTexto rotulo="Sistema do portal (ex.: Betha)" valor={dados.sistemaPortal} onMudar={(v) => alterar({ sistemaPortal: v })} />
      <CampoTexto rotulo="URL do portal" valor={dados.portalUrl} onMudar={(v) => alterar({ portalUrl: v })} />
      <CampoTexto rotulo="E-mail de contato" tipo="email" valor={dados.contatoEmail} onMudar={(v) => alterar({ contatoEmail: v })} />
      <label className="block text-sm sm:col-span-2">
        <span className="font-medium text-slate-700">Observação</span>
        <textarea
          value={dados.observacao}
          onChange={(e) => alterar({ observacao: e.target.value })}
          rows={3}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
        />
      </label>
      {erro && <p className="text-sm text-red-600 sm:col-span-2">{erro}</p>}
      <div className="sm:col-span-2">
        <button type="submit" disabled={planoPendente !== null} className="w-full rounded bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {cliente ? "Salvar alterações" : "Salvar cliente"}
        </button>
      </div>
    </form>
  );
}

function CampoTexto({
  rotulo,
  valor,
  onMudar,
  tipo = "text",
  obrigatorio = false
}: {
  rotulo: string;
  valor: string;
  onMudar: (v: string) => void;
  tipo?: string;
  obrigatorio?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{rotulo}</span>
      <input
        type={tipo}
        value={valor}
        onChange={(e) => onMudar(e.target.value)}
        required={obrigatorio}
        className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal focus:outline-none"
      />
    </label>
  );
}

const COR_ETIQUETA_MAPA: Record<SituacaoDivulgacao, string> = {
  no_mapa: "bg-emerald-50 text-emerald-700",
  fora_do_mapa: "bg-slate-100 text-slate-600",
  sem_autorizacao: "bg-slate-100 text-slate-600",
  posicao_pendente: "bg-amber-50 text-amber-800",
  sem_codigo: "bg-slate-50 text-slate-400"
};

/** Etiqueta do mapa público na listagem (rodada 15-B). */
function EtiquetaMapa({ situacao }: { situacao: SituacaoDivulgacao }) {
  return (
    <span data-testid="etiqueta-mapa" className={`rounded px-2 py-0.5 text-xs font-medium ${COR_ETIQUETA_MAPA[situacao]}`}>
      {ROTULO_SITUACAO_DIVULGACAO[situacao]}
    </span>
  );
}
