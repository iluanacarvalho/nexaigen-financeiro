"use client";

// Notas fiscais (rodada 08) — TODAS as notas, com filtros (situação,
// cliente, competência), busca por número, ordenação e paginação no
// servidor (GET /api/notas); criação de nota com PDF opcional; e as ações
// por linha (atesto, pagamento, cancelar, reabrir pagamento), sempre com
// confirmação. Os botões que aparecem em cada linha vêm da MESMA máquina
// de estados que o servidor usa pra validar (lib/estadoNota.ts#acoesPermitidas)
// — a tela nunca oferece uma ação que o servidor recusaria, e o servidor
// recusa (409) mesmo se alguém chamar a API direto.

import { useEffect, useState } from "react";
import Paginacao from "@/components/Paginacao";
import PdfVersionado from "@/components/PdfVersionado";
import { formatarMoeda, paraCentavos } from "@/lib/dinheiro";
import { ROTULO_SITUACAO_NOTA, SITUACOES, acoesPermitidas, faseDaSituacao, type AcaoNota, type SituacaoNota } from "@/lib/estadoNota";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";
import type { ClientePrefeitura, EventoNota, NotaListada, TipoEventoNota } from "@/lib/tipos";

const POR_PAGINA = 25;

interface Filtros {
  situacao: string;
  cliente_id: string;
  competencia: string;
  busca: string;
  ordenar: string;
  direcao: "asc" | "desc";
}

const FILTROS_INICIAIS: Filtros = { situacao: "", cliente_id: "", competencia: "", busca: "", ordenar: "data_emissao", direcao: "desc" };

const ROTULO_ACAO: Record<AcaoNota, string> = {
  registrar_atesto: "Registrar atesto",
  registrar_pagamento: "Registrar pagamento",
  cancelar: "Cancelar nota",
  reabrir_pagamento: "Reabrir pagamento"
};

const ROTULO_EVENTO: Record<TipoEventoNota, string> = {
  criacao: "Nota criada",
  verificacao_portal: "Checagem no portal",
  atesto: "Atesto registrado",
  pagamento: "Pagamento registrado",
  cancelamento: "Nota cancelada",
  reabertura_pagamento: "Pagamento reaberto"
};

const COR_SITUACAO: Record<SituacaoNota, string> = {
  aguardando_atesto: "bg-slate-100 text-slate-700",
  atestada: "bg-sky-50 text-sky-700",
  vencida: "bg-amber-50 text-amber-800",
  atraso_critico: "bg-red-50 text-alerta",
  paga: "bg-emerald-50 text-emerald-700",
  cancelada: "bg-slate-100 text-slate-400 line-through"
};

interface PaginaNotas {
  notas: NotaListada[];
  total: number;
}

type AcaoPendente = { nota: NotaListada; acao: AcaoNota; data: string; motivo: string; erro: string | null; enviando: boolean };

function montarQuery(filtros: Filtros, pagina: number): string {
  const p = new URLSearchParams({ ordenar: filtros.ordenar, direcao: filtros.direcao, pagina: String(pagina), por_pagina: String(POR_PAGINA) });
  if (filtros.situacao) p.set("situacao", filtros.situacao);
  if (filtros.cliente_id) p.set("cliente_id", filtros.cliente_id);
  if (filtros.competencia) p.set("competencia", filtros.competencia);
  if (filtros.busca.trim()) p.set("busca", filtros.busca.trim());
  return p.toString();
}

async function buscarNotas(filtros: Filtros, pagina: number): Promise<PaginaNotas | { erro: string }> {
  const res = await fetch(`/api/notas?${montarQuery(filtros, pagina)}`);
  if (!res.ok) return { erro: "Não foi possível carregar as notas — confira os filtros." };
  return res.json();
}

async function buscarClientes(): Promise<ClientePrefeitura[]> {
  const res = await fetch("/api/clientes");
  if (!res.ok) return [];
  return (await res.json()).clientes ?? [];
}

const formatarMes = (competencia: string) => `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;
const formatarData = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

export default function NotasPage() {
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIAIS);
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<PaginaNotas>({ notas: [], total: 0 });
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [clientes, setClientes] = useState<ClientePrefeitura[]>([]);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [acaoPendente, setAcaoPendente] = useState<AcaoPendente | null>(null);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [eventos, setEventos] = useState<Record<string, EventoNota[] | "erro">>({});

  async function carregar(f: Filtros = filtros, p: number = pagina) {
    setCarregando(true);
    const r = await buscarNotas(f, p);
    if ("erro" in r) setErroLista(r.erro);
    else {
      setErroLista(null);
      setDados(r);
    }
    setCarregando(false);
  }

  // Carga inicial: estado só muda nos callbacks das Promises (react-hooks/set-state-in-effect).
  useEffect(() => {
    let ativo = true;
    buscarNotas(FILTROS_INICIAIS, 1).then((r) => {
      if (!ativo) return;
      if ("erro" in r) setErroLista(r.erro);
      else setDados(r);
      setCarregando(false);
    });
    buscarClientes().then((lista) => {
      if (ativo) setClientes(lista);
    });
    return () => {
      ativo = false;
    };
  }, []);

  function aplicarFiltros(novos: Partial<Filtros>) {
    const f = { ...filtros, ...novos };
    setFiltros(f);
    setPagina(1);
    carregar(f, 1);
  }

  async function carregarEventos(notaId: string) {
    const res = await fetch(`/api/notas/${notaId}/eventos`);
    const dadosEventos = res.ok ? ((await res.json()).eventos as EventoNota[]) : "erro";
    setEventos((e) => ({ ...e, [notaId]: dadosEventos }));
  }

  function alternarDetalhes(notaId: string) {
    const abrir = expandida !== notaId;
    setExpandida(abrir ? notaId : null);
    if (abrir) carregarEventos(notaId);
  }

  function iniciarAcao(nota: NotaListada, acao: AcaoNota) {
    setAcaoPendente({ nota, acao, data: hojeEmSaoPaulo(new Date()), motivo: "", erro: null, enviando: false });
  }

  async function confirmarAcao() {
    if (!acaoPendente) return;
    const { nota, acao, data, motivo } = acaoPendente;
    setAcaoPendente({ ...acaoPendente, enviando: true, erro: null });
    const corpo = acao === "cancelar" || acao === "reabrir_pagamento" ? { acao, motivo } : { acao, data };
    const res = await fetch(`/api/notas/${nota.id}/acoes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setAcaoPendente({ ...acaoPendente, enviando: false, erro: d?.erro ?? "Não foi possível concluir a ação." });
      return;
    }
    setAcaoPendente(null);
    if (expandida === nota.id) carregarEventos(nota.id);
    carregar();
  }

  const clientesAtivos = clientes.filter((c) => c.status_contrato === "ativo");

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">Notas fiscais</h1>
        <button type="button" onClick={() => setMostrarForm(!mostrarForm)} className="rounded bg-navy px-4 py-2 text-sm text-white">
          {mostrarForm ? "Fechar" : "+ Nova nota"}
        </button>
      </div>

      {mostrarForm && (
        <FormNovaNota
          clientes={clientesAtivos}
          onCriada={() => {
            setMostrarForm(false);
            carregar();
          }}
        />
      )}

      <form
        aria-label="Filtros"
        className="mb-4 grid gap-3 rounded-lg border bg-white p-4 text-sm shadow-sm sm:grid-cols-3 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          aplicarFiltros({ busca: String(new FormData(e.currentTarget).get("busca") ?? "") });
        }}
      >
        <label className="block">
          <span className="text-slate-600">Situação</span>
          <select value={filtros.situacao} onChange={(e) => aplicarFiltros({ situacao: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            <option value="">Todas</option>
            {SITUACOES.map((s) => (
              <option key={s} value={s}>
                {ROTULO_SITUACAO_NOTA[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-slate-600">Cliente</span>
          <select value={filtros.cliente_id} onChange={(e) => aplicarFiltros({ cliente_id: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            <option value="">Todos</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} — {c.uf}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-slate-600">Competência</span>
          <input type="month" value={filtros.competencia} onChange={(e) => aplicarFiltros({ competencia: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
        </label>
        <label className="block">
          <span className="text-slate-600">Ordenar por</span>
          <select value={filtros.ordenar} onChange={(e) => aplicarFiltros({ ordenar: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            <option value="data_emissao">Emissão</option>
            <option value="competencia">Competência</option>
            <option value="valor">Valor</option>
            <option value="numero_nf">Número da NF</option>
            <option value="situacao">Situação</option>
            <option value="cliente">Cliente</option>
          </select>
        </label>
        <label className="block">
          <span className="text-slate-600">Ordem</span>
          <select value={filtros.direcao} onChange={(e) => aplicarFiltros({ direcao: e.target.value as "asc" | "desc" })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            <option value="desc">Decrescente</option>
            <option value="asc">Crescente</option>
          </select>
        </label>
        <label className="block">
          <span className="text-slate-600">Número da NF</span>
          <span className="mt-1 flex gap-1">
            <input name="busca" defaultValue={filtros.busca} maxLength={60} className="w-full rounded border border-slate-300 px-2 py-1" />
            <button type="submit" className="rounded border border-slate-300 px-2">
              Buscar
            </button>
          </span>
        </label>
      </form>

      {erroLista && <p className="mb-3 text-sm text-red-600">{erroLista}</p>}
      {carregando && <p className="text-sm text-slate-400">Carregando...</p>}

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-navy text-white">
            <tr>
              <th className="p-3 text-left">NF</th>
              <th className="p-3 text-left">Cliente</th>
              <th className="p-3 text-left">Competência</th>
              <th className="p-3 text-right">Valor</th>
              <th className="p-3 text-left">Emissão</th>
              <th className="p-3 text-left">Vencimento</th>
              <th className="p-3 text-left">Situação</th>
              <th className="p-3 text-left">Ações</th>
            </tr>
          </thead>
          <tbody>
            {dados.notas.map((n) => (
              <LinhaNota
                key={n.id}
                nota={n}
                expandida={expandida === n.id}
                eventos={eventos[n.id]}
                acaoPendente={acaoPendente?.nota.id === n.id ? acaoPendente : null}
                onAcao={(acao) => iniciarAcao(n, acao)}
                onAlterarAcao={(campos) => acaoPendente && setAcaoPendente({ ...acaoPendente, ...campos })}
                onConfirmar={confirmarAcao}
                onDesistir={() => setAcaoPendente(null)}
                onDetalhes={() => alternarDetalhes(n.id)}
                onPdfEnviado={() => carregar()}
              />
            ))}
            {!carregando && dados.notas.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-400">
                  Nenhuma nota encontrada{JSON.stringify(filtros) !== JSON.stringify(FILTROS_INICIAIS) ? " com estes filtros" : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Paginacao
        pagina={pagina}
        porPagina={POR_PAGINA}
        total={dados.total}
        onMudar={(p) => {
          setPagina(p);
          carregar(filtros, p);
        }}
      />
    </main>
  );
}

function LinhaNota({
  nota,
  expandida,
  eventos,
  acaoPendente,
  onAcao,
  onAlterarAcao,
  onConfirmar,
  onDesistir,
  onDetalhes,
  onPdfEnviado
}: {
  nota: NotaListada;
  expandida: boolean;
  eventos: EventoNota[] | "erro" | undefined;
  acaoPendente: AcaoPendente | null;
  onAcao: (acao: AcaoNota) => void;
  onAlterarAcao: (campos: Partial<AcaoPendente>) => void;
  onConfirmar: () => void;
  onDesistir: () => void;
  onDetalhes: () => void;
  onPdfEnviado: () => void;
}) {
  const acoes = acoesPermitidas(faseDaSituacao(nota.situacao));
  return (
    <>
      <tr className="border-t align-top" data-testid={`nota-${nota.id}`}>
        <td className="p-3">{nota.numero_nf ?? "—"}</td>
        <td className="p-3">
          {nota.cliente.nome} — {nota.cliente.uf}
        </td>
        <td className="p-3">{formatarMes(nota.competencia)}</td>
        <td className="p-3 text-right">{formatarMoeda(paraCentavos(nota.valor))}</td>
        <td className="p-3">{formatarData(nota.data_emissao)}</td>
        <td className="p-3">{formatarData(nota.data_limite_pagamento)}</td>
        <td className="p-3">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${COR_SITUACAO[nota.situacao]}`}>{ROTULO_SITUACAO_NOTA[nota.situacao]}</span>
        </td>
        <td className="p-3">
          <div className="flex flex-wrap gap-1">
            {acoes.map((acao) => (
              <button
                key={acao}
                type="button"
                onClick={() => onAcao(acao)}
                disabled={acaoPendente !== null}
                className={`rounded px-2 py-1 text-xs ${acao === "cancelar" || acao === "reabrir_pagamento" ? "border border-red-200 text-red-700" : "border border-slate-300 text-slate-700"} disabled:opacity-50`}
              >
                {ROTULO_ACAO[acao]}
              </button>
            ))}
            <button type="button" onClick={onDetalhes} aria-expanded={expandida} className="rounded px-2 py-1 text-xs text-navy underline">
              {expandida ? "Ocultar detalhes" : "Detalhes"}
            </button>
          </div>
        </td>
      </tr>
      {acaoPendente && (
        <tr>
          <td colSpan={8} className="bg-amber-50 p-3">
            <PainelConfirmacao pendente={acaoPendente} onAlterar={onAlterarAcao} onConfirmar={onConfirmar} onDesistir={onDesistir} />
          </td>
        </tr>
      )}
      {expandida && (
        <tr>
          <td colSpan={8} className="bg-slate-50 p-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 font-semibold text-navy">PDF da nota</p>
                <PdfVersionado urlArquivo={`/api/notas/${nota.id}/arquivo`} rotulo="nota fiscal" versaoAtual={nota.arquivo_pdf_versao_atual} nomeAtual={nota.arquivo_pdf_nome} onEnviado={onPdfEnviado} />
                {nota.situacao === "cancelada" && nota.motivo_cancelamento && <p className="mt-2 text-xs text-slate-600">Motivo do cancelamento: {nota.motivo_cancelamento}</p>}
              </div>
              <div>
                <p className="mb-1 font-semibold text-navy">Histórico</p>
                <HistoricoEventos eventos={eventos} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function PainelConfirmacao({
  pendente,
  onAlterar,
  onConfirmar,
  onDesistir
}: {
  pendente: AcaoPendente;
  onAlterar: (campos: Partial<AcaoPendente>) => void;
  onConfirmar: () => void;
  onDesistir: () => void;
}) {
  const { acao, nota } = pendente;
  const pedeMotivo = acao === "cancelar" || acao === "reabrir_pagamento";
  const texto: Record<AcaoNota, string> = {
    registrar_atesto: `Registrar o atesto da NF ${nota.numero_nf ?? "sem número"}? O prazo legal de pagamento (30 dias) passa a contar desta data.`,
    registrar_pagamento: `Registrar o pagamento da NF ${nota.numero_nf ?? "sem número"}? A nota sai do "a receber" e os alertas de cobrança são encerrados.`,
    cancelar: `Cancelar a NF ${nota.numero_nf ?? "sem número"}? Nota cancelada não pode voltar a ser cobrada.`,
    reabrir_pagamento: `Reabrir o pagamento registrado em ${formatarData(nota.data_pagamento)}? Use só se ele foi registrado por engano — a nota volta para "a receber".`
  };
  return (
    <div role="dialog" aria-label={`Confirmar: ${ROTULO_ACAO[acao]}`} className="text-sm">
      <p className="font-medium text-slate-800">{texto[acao]}</p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        {pedeMotivo ? (
          <label className="block w-full max-w-lg">
            <span className="text-xs text-slate-700">Motivo (obrigatório)</span>
            <textarea
              value={pendente.motivo}
              maxLength={300}
              rows={2}
              onChange={(e) => onAlterar({ motivo: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
            />
            <span className="text-xs text-slate-400">{pendente.motivo.length}/300</span>
          </label>
        ) : (
          <label className="block">
            <span className="text-xs text-slate-700">Data {acao === "registrar_atesto" ? "do atesto" : "do pagamento"}</span>
            <input type="date" value={pendente.data} max={hojeEmSaoPaulo(new Date())} onChange={(e) => onAlterar({ data: e.target.value })} className="mt-1 block rounded border border-slate-300 px-2 py-1" />
          </label>
        )}
        <button
          type="button"
          onClick={onConfirmar}
          disabled={pendente.enviando || (pedeMotivo && pendente.motivo.trim().length === 0)}
          className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pendente.enviando ? "Salvando..." : `Confirmar: ${ROTULO_ACAO[acao]}`}
        </button>
        <button type="button" onClick={onDesistir} disabled={pendente.enviando} className="rounded border border-slate-300 px-3 py-1.5 text-xs">
          Voltar
        </button>
      </div>
      {pendente.erro && <p className="mt-2 text-xs text-red-600">{pendente.erro}</p>}
    </div>
  );
}

function HistoricoEventos({ eventos }: { eventos: EventoNota[] | "erro" | undefined }) {
  if (eventos === undefined) return <p className="text-xs text-slate-400">Carregando histórico...</p>;
  if (eventos === "erro") return <p className="text-xs text-red-600">Não foi possível carregar o histórico.</p>;
  if (eventos.length === 0) return <p className="text-xs text-slate-400">Nenhum evento registrado.</p>;
  return (
    <ol className="space-y-1 border-l border-slate-200 pl-3 text-xs">
      {eventos.map((e) => (
        <li key={e.id}>
          <span className="font-semibold text-navy">{ROTULO_EVENTO[e.tipo]}</span>
          {e.data_evento && <span> · data {formatarData(e.data_evento)}</span>}
          <span className="text-slate-500">
            {" "}
            · {new Date(e.feito_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} · por{" "}
            {e.feito_por_nome ?? "sistema / registro anterior ao histórico"}
          </span>
          {e.motivo && <p className="text-slate-700">Motivo: {e.motivo}</p>}
          {e.observacao && <p className="text-slate-500">{e.observacao}</p>}
        </li>
      ))}
    </ol>
  );
}

function FormNovaNota({ clientes, onCriada }: { clientes: ClientePrefeitura[]; onCriada: () => void }) {
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(form: HTMLFormElement) {
    const fd = new FormData(form);
    setErros({});
    setErroGeral(null);
    setAviso(null);
    setEnviando(true);
    const corpo = {
      cliente_id: String(fd.get("cliente_id") ?? ""),
      competencia: String(fd.get("competencia") ?? ""),
      numero_nf: String(fd.get("numero_nf") ?? ""),
      valor: String(fd.get("valor") ?? ""),
      data_emissao: String(fd.get("data_emissao") ?? "") || undefined
    };
    const res = await fetch("/api/notas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    const dados = await res.json().catch(() => null);
    if (!res.ok) {
      setEnviando(false);
      const campos = dados?.detalhes?.fieldErrors ?? {};
      setErros(Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, Array.isArray(v) ? String(v[0]) : String(v)])));
      setErroGeral(dados?.erro ?? "Não foi possível criar a nota.");
      return;
    }

    const pdf = fd.get("pdf");
    if (pdf instanceof File && pdf.size > 0) {
      const envio = new FormData();
      envio.set("arquivo", pdf);
      const r = await fetch(`/api/notas/${dados.id}/arquivo`, { method: "POST", body: envio });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setEnviando(false);
        setAviso(`Nota criada, mas o PDF não foi anexado: ${d?.erro ?? "erro ao enviar"}. Anexe pelos detalhes da nota.`);
        form.reset();
        onCriada();
        return;
      }
    }
    setEnviando(false);
    form.reset();
    onCriada();
  }

  return (
    <form
      aria-label="Nova nota fiscal"
      className="mb-6 grid gap-3 rounded-lg border bg-white p-6 text-sm shadow-sm sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        enviar(e.currentTarget);
      }}
    >
      <Campo rotulo="Cliente (contrato ativo)" erro={erros.cliente_id}>
        <select name="cliente_id" required className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
          <option value="">Selecione…</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome} — {c.uf}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Competência (mês)" erro={erros.competencia}>
        <input name="competencia" type="month" required className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
      </Campo>
      <Campo rotulo="Número da NF" erro={erros.numero_nf}>
        <input name="numero_nf" maxLength={60} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
      </Campo>
      <Campo rotulo="Valor (R$) — ex.: 4500,50" erro={erros.valor}>
        <input name="valor" inputMode="decimal" required className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
      </Campo>
      <Campo rotulo="Data de emissão (vazio = hoje)" erro={erros.data_emissao}>
        <input name="data_emissao" type="date" max={hojeEmSaoPaulo(new Date())} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
      </Campo>
      <Campo rotulo="PDF da nota (opcional)">
        <input name="pdf" type="file" accept="application/pdf,.pdf" className="mt-1 w-full text-xs" />
      </Campo>
      <div className="sm:col-span-3">
        {erroGeral && (
          <p role="alert" className="mb-2 text-red-600">
            {erroGeral}
          </p>
        )}
        {aviso && <p className="mb-2 text-amber-700">{aviso}</p>}
        <button type="submit" disabled={enviando} className="w-full rounded bg-teal px-4 py-2 font-medium text-white disabled:opacity-50">
          {enviando ? "Salvando..." : "Criar nota"}
        </button>
      </div>
    </form>
  );
}

function Campo({ rotulo, erro, children }: { rotulo: string; erro?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-medium text-slate-700">{rotulo}</span>
      {children}
      {erro && <span className="mt-1 block text-xs text-red-600">{erro}</span>}
    </label>
  );
}
