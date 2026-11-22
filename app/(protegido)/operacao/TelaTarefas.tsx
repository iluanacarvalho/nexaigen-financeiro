"use client";

// Tela de TAREFAS (rodada 16-B1). Abas: "Minhas tarefas", "Fila do meu
// papel" e, só admin, "Todas" e "Em atraso". Selos "atrasada" (prazo antes
// de hoje) e "vence hoje". Ações: assumir, devolver à fila, concluir
// (implantação, com observação), alterar prazo e cancelar (só admin). Na
// tarefa de CONTRATO: baixar o contrato gerado e registrar a assinatura
// (data + PDF assinado) — que conclui a tarefa e abre a de implantação.
// Cada tarefa mostra SÓ os dados do cliente que o papel precisa (o
// servidor já manda só esses).

import { useCallback, useEffect, useState } from "react";
import { formatarCep, formatarCnpj } from "@/lib/cnpj";
import { formatarMoeda } from "@/lib/dinheiro";
import { ROTULO_ACAO_TAREFA, ROTULO_STATUS_TAREFA, ROTULO_TIPO_TAREFA } from "@/lib/fechamento";
import { rotuloDoPlano } from "@/lib/planos";
import type { AbaTarefas } from "@/lib/fechamentoSchemas";
import type { TarefaListada } from "@/lib/tarefasServico";

const dataBr = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

async function postar(url: string, corpo: object): Promise<string | null> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  if (res.ok) return null;
  const d = await res.json().catch(() => null);
  return d?.erro ?? "Não foi possível concluir a ação.";
}

function DadosCliente({ t }: { t: TarefaListada }) {
  const c = t.cliente as unknown as Record<string, unknown>;
  const linha = (rotulo: string, v: unknown) =>
    v === null || v === undefined || v === "" ? null : (
      <div key={rotulo}>
        <dt className="inline text-slate-500">{rotulo}: </dt>
        <dd className="inline">{String(v)}</dd>
      </div>
    );
  return (
    <dl className="grid gap-x-4 text-xs sm:grid-cols-2" data-testid="dados-cliente">
      {linha("Plano", rotuloDoPlano(String(c.plano)))}
      {"valor_mensal_centavos" in c && linha("Mensalidade", formatarMoeda(c.valor_mensal_centavos as number))}
      {"taxa_implantacao_centavos" in c && linha("Taxa de implantação", c.taxa_implantacao_centavos === null ? "sem taxa" : formatarMoeda(c.taxa_implantacao_centavos as number))}
      {"cnpj" in c && linha("CNPJ", c.cnpj ? formatarCnpj(String(c.cnpj)) : "—")}
      {"endereco_logradouro" in c &&
        linha(
          "Endereço",
          [c.endereco_logradouro, c.endereco_numero, c.endereco_complemento, c.endereco_bairro].filter(Boolean).join(", ") + (c.endereco_cep ? ` — CEP ${formatarCep(String(c.endereco_cep))}` : "")
        )}
      {"representante_nome" in c && linha("Representante legal", [c.representante_nome, c.representante_cargo].filter(Boolean).join(" — "))}
      {"uf" in c && linha("UF", c.uf)}
      {"codigo_ibge" in c && linha("Código IBGE", c.codigo_ibge ?? "—")}
      {linha("Contato", [c.contato_nome, c.contato_cargo, c.contato_email, c.contato_telefone].filter(Boolean).join(" · "))}
    </dl>
  );
}

function RegistrarAssinatura({ clienteId, onFeito }: { clienteId: string; onFeito: () => void }) {
  const [data, setData] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!arquivo || !data) return setErro("Informe a data e o PDF assinado.");
    setEnviando(true);
    setErro(null);
    const fd = new FormData();
    fd.set("data_assinatura", data);
    fd.set("arquivo", arquivo);
    const res = await fetch(`/api/operacao/clientes/${clienteId}/assinatura`, { method: "POST", body: fd });
    setEnviando(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      return setErro(d?.detalhes?.fieldErrors?.data_assinatura?.[0] ?? d?.erro ?? "Não foi possível registrar a assinatura.");
    }
    onFeito();
  }
  return (
    <form onSubmit={enviar} aria-label="Registrar assinatura" className="mt-2 flex flex-wrap items-end gap-2 rounded border border-teal/40 bg-teal/5 p-2 text-xs">
      <label className="block">
        <span className="text-slate-700">Data da assinatura</span>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="mt-0.5 block rounded border border-slate-300 px-2 py-1" />
      </label>
      <label className="block">
        <span className="text-slate-700">PDF assinado</span>
        <input type="file" accept="application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="mt-0.5 block" />
      </label>
      <button type="submit" disabled={enviando} className="rounded bg-teal px-3 py-1.5 font-semibold text-white disabled:opacity-50">
        {enviando ? "Registrando..." : "Registrar assinatura"}
      </button>
      {erro && (
        <span role="alert" className="text-red-700">
          {erro}
        </span>
      )}
      <span className="w-full text-slate-500">A vigência e a cobrança começam nesta data. O PDF é guardado como nova versão do contrato.</span>
    </form>
  );
}

function CartaoTarefa({ t, admin, papel, recarregar }: { t: TarefaListada; admin: boolean; papel: string; recarregar: () => void }) {
  const [erro, setErro] = useState<string | null>(null);
  const [observacao, setObservacao] = useState("");
  const [prazo, setPrazo] = useState(t.prazo);
  const [motivo, setMotivo] = useState("");
  const aberta = t.status === "aberta" || t.status === "em_andamento";
  async function agir(corpo: object) {
    const falha = await postar(`/api/operacao/tarefas/${t.id}`, corpo);
    setErro(falha);
    if (!falha) recarregar();
  }
  return (
    <li className="rounded-lg border bg-white p-3 text-sm shadow-sm" data-testid={`tarefa-${t.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium">{ROTULO_TIPO_TAREFA[t.tipo]}</span>
        <strong className="text-navy">{t.cliente.nome}</strong>
        <span className="text-xs text-slate-600">
          {ROTULO_STATUS_TAREFA[t.status]}
          {t.responsavel_nome ? ` · com ${t.minha ? "você" : t.responsavel_nome}` : ""} · prazo {dataBr(t.prazo)}
        </span>
        {t.selo === "atrasada" && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800" data-testid="selo-atrasada">
            atrasada
          </span>
        )}
        {t.selo === "vence_hoje" && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900" data-testid="selo-vence-hoje">
            vence hoje
          </span>
        )}
      </div>
      <div className="mt-2">
        <DadosCliente t={t} />
      </div>
      {aberta && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {t.status === "aberta" && (
            <button type="button" onClick={() => void agir({ acao: "assumir" })} className="rounded bg-navy px-2 py-1 text-white">
              Assumir
            </button>
          )}
          {t.status === "em_andamento" && (t.minha || admin) && (
            <button type="button" onClick={() => void agir({ acao: "devolver" })} className="rounded border border-slate-300 px-2 py-1">
              Devolver à fila
            </button>
          )}
          {t.tipo === "contrato_assinatura" && (
            <a href={`/api/clientes/${t.cliente.id}/contrato/gerar`} className="rounded border border-navy px-2 py-1 text-navy">
              Baixar contrato gerado (.docx)
            </a>
          )}
          {t.tipo === "implantacao" && (t.minha || admin) && (
            <span className="flex items-center gap-1">
              <input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={1000} placeholder="Observação (opcional)" aria-label="Observação da conclusão" className="rounded border border-slate-300 px-2 py-1" />
              <button type="button" onClick={() => void agir({ acao: "concluir", observacao })} className="rounded bg-teal px-2 py-1 text-white">
                Concluir implantação
              </button>
            </span>
          )}
          {admin && (
            <>
              <span className="flex items-center gap-1">
                <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} aria-label="Novo prazo" className="rounded border border-slate-300 px-1 py-0.5" />
                <button type="button" onClick={() => void agir({ acao: "prazo", prazo })} className="rounded border border-slate-300 px-2 py-1">
                  Alterar prazo
                </button>
              </span>
              <span className="flex items-center gap-1">
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} placeholder="Motivo" aria-label="Motivo do cancelamento" className="rounded border border-slate-300 px-2 py-1" />
                <button type="button" onClick={() => void agir({ acao: "cancelar", motivo })} className="rounded border border-red-300 px-2 py-1 text-red-800">
                  Cancelar tarefa
                </button>
              </span>
            </>
          )}
        </div>
      )}
      {aberta && t.tipo === "contrato_assinatura" && (papel === "contratos" || admin) && <RegistrarAssinatura clienteId={t.cliente.id} onFeito={recarregar} />}
      {erro && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {erro}
        </p>
      )}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-slate-600">Histórico ({t.historico.length})</summary>
        <ol className="ml-4 list-disc" aria-label="Histórico da tarefa">
          {t.historico.map((h, i) => (
            <li key={i}>
              {ROTULO_ACAO_TAREFA[h.acao as keyof typeof ROTULO_ACAO_TAREFA] ?? h.acao} — {h.autor_nome ?? "—"} — {quando(h.em)}
              {h.detalhe ? ` — ${h.detalhe}` : ""}
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
}

export default function TelaTarefas({ admin, papel }: { admin: boolean; papel: string }) {
  const [aba, setAba] = useState<AbaTarefas>("minhas");
  const [dados, setDados] = useState<{ tarefas: TarefaListada[]; contagem: { abertas: number; atrasadas: number; minhas: number } } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/operacao/tarefas?aba=${aba}`).then(async (res) => {
      if (!ativo) return;
      if (!res.ok) return setErro("Não foi possível carregar as tarefas.");
      setErro(null);
      setDados(await res.json());
    });
    return () => {
      ativo = false;
    };
  }, [aba, versao]);

  const abas: { id: AbaTarefas; rotulo: string }[] = [
    { id: "minhas", rotulo: "Minhas tarefas" },
    { id: "fila", rotulo: admin ? "Fila (não assumidas)" : "Fila do meu papel" },
    ...(admin ? [{ id: "todas" as const, rotulo: "Todas" }, { id: "atrasadas" as const, rotulo: "Em atraso" }] : [])
  ];

  return (
    <div>
      {dados && (
        <p className="mb-3 text-sm" data-testid="contagem-tarefas">
          <strong>{dados.contagem.abertas}</strong> {dados.contagem.abertas === 1 ? "tarefa aberta" : "tarefas abertas"} ·{" "}
          <strong className={dados.contagem.atrasadas > 0 ? "text-red-700" : ""}>{dados.contagem.atrasadas}</strong> {dados.contagem.atrasadas === 1 ? "atrasada" : "atrasadas"} ·{" "}
          {dados.contagem.minhas} com você
        </p>
      )}
      <div role="tablist" aria-label="Abas de tarefas" className="mb-3 flex flex-wrap gap-1">
        {abas.map((a) => (
          <button key={a.id} role="tab" aria-selected={aba === a.id} type="button" onClick={() => setAba(a.id)} className={`rounded px-3 py-1 text-sm ${aba === a.id ? "bg-navy text-white" : "border border-slate-300"}`}>
            {a.rotulo}
          </button>
        ))}
      </div>
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      {dados && dados.tarefas.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-slate-600">{aba === "minhas" ? "Nenhuma tarefa com você. Veja a fila para assumir uma." : "Nenhuma tarefa aqui."}</p>
      ) : (
        <ul className="space-y-3" aria-label="Tarefas">
          {dados?.tarefas.map((t) => (
            <CartaoTarefa key={`${t.id}-${t.status}-${t.prazo}`} t={t} admin={admin} papel={papel} recarregar={recarregar} />
          ))}
        </ul>
      )}
    </div>
  );
}
