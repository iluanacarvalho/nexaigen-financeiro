// FECHAMENTO (rodada 16-B1) — escrita do ACEITE e da ASSINATURA.
//
// ACEITE (registrarAceite): UMA transação, tudo ou nada —
//   (a) lead → 'ganho' + linha no histórico (o ÚNICO caminho que grava
//       'ganho': a API genérica de etapa continua recusando);
//   (b) cliente em 'aguardando_assinatura' (sem data de início, sem
//       cobrança) ligado ao lead — ou, se o município é EX-CLIENTE, a mesma
//       linha do cliente volta pra 'aguardando_assinatura' (o código IBGE é
//       único entre clientes; notas e eventos do contrato antigo ficam);
//   (c) evento 'aceite_registrado';
//   (d) tarefa 'contrato_assinatura' pro papel Contratos, com prazo.
// Regras: só o dono do lead ou admin (lead de colega → 404, como todo o
// CRM); lead precisa de código IBGE (vincular ao município da base antes);
// cliente VIGENTE do município → 409; aceite repetido no mesmo lead → 409.
//
// ASSINATURA (registrarAssinatura): a pessoa de Contratos (ou admin) informa
// a data (não futura) e o PDF assinado. O PDF entra PRIMEIRO, pelo
// armazenamento versionado de sempre (lib/versionamentoPdf.ts — bucket fora
// do ar = a mesma mensagem de sempre, NADA muda). Só com o PDF aceito, numa
// transação: cliente → 'ativo' com data_inicio_contrato = data da assinatura
// (a partir daí valem períodos de 30 dias, notas e MRR), evento
// 'assinatura_registrada', tarefa de assinatura concluída e tarefa de
// IMPLANTAÇÃO aberta. Nenhuma nota é criada automaticamente.

import { query, withTransaction, type Executor } from "./db";
import { clienteEncerrado, clientesDoMunicipio, etapaAberta, ROTULO_ETAPA, type Etapa } from "./crm";
import { condicaoEscopo, lerClientesDosMunicipios, type EscopoCrm } from "./crmRepositorio";
import { MENSAGEM_VERSAO } from "./crmServico";
import { rotuloStatusContrato, statusContratoNaData } from "./cancelamentoContrato";
import { centavosParaNumeric } from "./dinheiro";
import { formatarReais } from "./extenso";
import { nomeDeMunicipioNormalizado } from "./ibge";
import { nomeDoCliente, prazoAssinatura, prazoImplantacao } from "./fechamento";
import type { DadosAceite } from "./fechamentoSchemas";
import { rotuloDoPlano } from "./planos";
import { ALVO_CONTRATO, registrarVersaoPdf } from "./versionamentoPdf";

export type FalhaFechamento =
  | { ok: false; motivo: "nao_encontrado" }
  | { ok: false; motivo: "conflito" | "dados_invalidos" | "proibido" | "bucket" | "banco"; erro: string; campo?: string };

export type ResultadoFechamento<T> = ({ ok: true } & T) | FalhaFechamento;

class Recusa extends Error {
  constructor(readonly falha: FalhaFechamento) {
    super("fechamento recusado");
  }
}

export const MENSAGEM_VINCULAR_ANTES = "Este lead não está vinculado a um município da base (código IBGE). Vincule o município no detalhe do lead antes de registrar o aceite.";

// --- Aceite ---------------------------------------------------------------------------

interface LeadParaAceite {
  id: string;
  etapa: Etapa;
  versao: number;
  uf: string;
  municipio_nome: string;
  codigo_ibge: string | null;
}

/** Registra o aceite da prefeitura. `autor` no escopo do CRM: vendas só nos SEUS leads. */
export async function registrarAceite(
  leadId: string,
  dados: DadosAceite,
  autor: EscopoCrm,
  hoje: string,
  executor?: Executor
): Promise<ResultadoFechamento<{ clienteId: string; tarefaId: string; reaproveitouExCliente: boolean }>> {
  const fazer = async (c: Executor) => {
    const params: unknown[] = [leadId];
    const [lead] = await query<LeadParaAceite>(
      `select l.id, l.etapa, l.versao, l.uf, l.municipio_nome, l.codigo_ibge from lead l
       where l.id = $1::uuid and ${condicaoEscopo(autor, params, "l")} for update`,
      params,
      c
    );
    if (!lead) throw new Recusa({ ok: false, motivo: "nao_encontrado" });
    if (lead.etapa === "ganho") {
      const [cli] = await query<{ nome: string; status_contrato: string }>(`select nome, status_contrato from cliente_prefeitura where lead_id = $1`, [lead.id], c);
      throw new Recusa({
        ok: false,
        motivo: "conflito",
        erro: `O aceite deste lead já foi registrado${cli ? ` — o cliente ${cli.nome} já existe (${rotuloStatusContrato(cli.status_contrato).toLowerCase()})` : ""}.`
      });
    }
    if (!etapaAberta(lead.etapa)) throw new Recusa({ ok: false, motivo: "conflito", erro: `Lead ${ROTULO_ETAPA[lead.etapa].toLowerCase()}: reabra o lead antes de registrar o aceite.` });
    if (lead.versao !== dados.versao) throw new Recusa({ ok: false, motivo: "conflito", erro: MENSAGEM_VERSAO });
    if (!lead.codigo_ibge) throw new Recusa({ ok: false, motivo: "conflito", erro: MENSAGEM_VINCULAR_ANTES });

    const [base] = await query<{ nome: string; uf: string }>(`select nome, uf from municipio_base where codigo_ibge = $1`, [lead.codigo_ibge], c);
    const municipio = base?.nome ?? lead.municipio_nome;
    const uf = base?.uf ?? lead.uf;

    // Cliente do MESMO município (código IBGE, ou UF + nome normalizado — a regra de sempre, lib/crm.ts).
    const doMunicipio = clientesDoMunicipio(await lerClientesDosMunicipios([uf], [lead.codigo_ibge], c), { uf, nomeBusca: nomeDeMunicipioNormalizado(municipio), codigoIbge: lead.codigo_ibge });
    const vigente = doMunicipio.find((cl) => !clienteEncerrado(cl, hoje));
    if (vigente) {
      throw new Recusa({
        ok: false,
        motivo: "conflito",
        erro: `Esta prefeitura já é cliente da NEXAIGEN (contrato ${rotuloStatusContrato(statusContratoNaData(vigente, hoje)).toLowerCase()}) — o aceite não cria outro cliente.`
      });
    }

    const valores = [
      nomeDoCliente(municipio), uf, lead.codigo_ibge, dados.plano, centavosParaNumeric(dados.valor_mensal),
      dados.taxa_implantacao === null ? null : centavosParaNumeric(dados.taxa_implantacao), dados.cnpj,
      dados.endereco_logradouro, dados.endereco_numero, dados.endereco_complemento ?? null, dados.endereco_bairro, dados.endereco_cep,
      dados.representante_nome, dados.representante_cargo, dados.contato_nome, dados.contato_cargo, dados.contato_email, dados.contato_telefone,
      lead.id, autor.equipeId
    ];
    // Ex-cliente (contrato ENCERRADO) com o MESMO código: a linha volta pra 'aguardando_assinatura' (código é único entre clientes).
    const [exCliente] = await query<{ id: string; autorizacao_divulgacao: boolean }>(
      `select id, autorizacao_divulgacao from cliente_prefeitura where codigo_ibge = $1 for update`,
      [lead.codigo_ibge],
      c
    );
    let clienteId: string;
    if (exCliente) {
      await query(
        `update cliente_prefeitura set nome = $1, uf = $2, plano = $4, valor_mensal = $5::numeric, taxa_implantacao = $6::numeric, cnpj = $7,
           endereco_logradouro = $8, endereco_numero = $9, endereco_complemento = $10, endereco_bairro = $11, endereco_cep = $12,
           representante_nome = $13, representante_cargo = $14, contato_nome = $15, contato_cargo = $16, contato_email = $17, contato_telefone = $18,
           lead_id = $19, fechado_em = now(), fechado_por = $20, status_contrato = 'aguardando_assinatura', data_inicio_contrato = null,
           cancelamento_pedido_em = null, cancelamento_termino_em = null, cancelamento_motivo = null,
           autorizacao_divulgacao = false, autorizacao_divulgacao_em = null, autorizacao_divulgacao_por = null
         where id = $21 and codigo_ibge = $3`,
        [...valores, exCliente.id],
        c
      );
      // A autorização de divulgação era do contrato ANTIGO: não vale pro novo (precisa de nova autorização por escrito).
      if (exCliente.autorizacao_divulgacao) {
        await query(
          `insert into cliente_evento_contrato (cliente_id, tipo, data_evento, detalhe, equipe_id, origem) values ($1, 'divulgacao_revogada', $2, $3, $4, 'sistema')`,
          [exCliente.id, hoje, "Revogada automaticamente: novo aceite de ex-cliente — a autorização era do contrato anterior.", autor.equipeId],
          c
        );
      }
      clienteId = exCliente.id;
    } else {
      const [novo] = await query<{ id: string }>(
        `insert into cliente_prefeitura (nome, uf, codigo_ibge, plano, valor_mensal, taxa_implantacao, cnpj,
           endereco_logradouro, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep,
           representante_nome, representante_cargo, contato_nome, contato_cargo, contato_email, contato_telefone,
           lead_id, fechado_em, fechado_por, status_contrato, data_inicio_contrato, dia_vencimento_contrato)
         values ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, now(), $20,
                 'aguardando_assinatura', null, 1)
         returning id`,
        valores,
        c
      );
      clienteId = novo.id;
    }

    const resumo = `plano ${rotuloDoPlano(dados.plano)}, mensalidade ${formatarReais(dados.valor_mensal)}${dados.taxa_implantacao === null ? ", sem taxa de implantação" : `, implantação ${formatarReais(dados.taxa_implantacao)}`}`;
    await query(
      `insert into cliente_evento_contrato (cliente_id, tipo, data_evento, detalhe, equipe_id, origem) values ($1, 'aceite_registrado', $2, $3, $4, 'painel')`,
      [clienteId, hoje, `Aceite registrado no CRM — ${resumo}.${exCliente ? " Ex-cliente: volta a aguardar assinatura." : ""}`.slice(0, 500), autor.equipeId],
      c
    );
    await query(
      `update lead set etapa = 'ganho', plano_interesse = $1, valor_mensal_estimado_centavos = $2, proxima_acao_em = null, proxima_acao_descricao = null,
         versao = versao + 1, atualizado_em = now() where id = $3`,
      [dados.plano, dados.valor_mensal, lead.id],
      c
    );
    await query(
      `insert into lead_interacao (lead_id, tipo, texto, etapa_anterior, etapa_nova, autor_id) values ($1, 'mudanca_etapa', $2, $3, 'ganho', $4)`,
      [lead.id, `Aceite da prefeitura registrado: ${nomeDoCliente(municipio)} aguarda a assinatura do contrato (${resumo}).`, lead.etapa, autor.equipeId],
      c
    );
    const [tarefa] = await query<{ id: string }>(
      `insert into tarefa_operacional (tipo, cliente_id, papel_responsavel, prazo) values ('contrato_assinatura', $1, 'contratos', $2) returning id`,
      [clienteId, prazoAssinatura(hoje, dados.data_prevista_assinatura ?? null)],
      c
    );
    await query(`insert into tarefa_historico (tarefa_id, acao, autor_id, detalhe) values ($1, 'criada', $2, $3)`, [tarefa.id, autor.equipeId, "Aberta pelo aceite registrado no CRM."], c);
    return { ok: true as const, clienteId, tarefaId: tarefa.id, reaproveitouExCliente: !!exCliente };
  };
  try {
    return await (executor ? fazer(executor) : withTransaction(fazer));
  } catch (erro) {
    if (erro instanceof Recusa) return erro.falha;
    const pg = erro as { code?: string; constraint?: string };
    // Corrida: outro aceite do mesmo município/lead gravou no meio (índices únicos de cliente) → a mesma resposta de duplicidade.
    if (pg?.code === "23505" && ["uq_cliente_prefeitura_codigo_ibge", "uq_cliente_prefeitura_lead", "uq_tarefa_aberta_por_cliente_tipo"].includes(pg.constraint ?? "")) {
      return { ok: false, motivo: "conflito", erro: "Esta prefeitura acabou de ser registrada como cliente por outra pessoa — recarregue a página." };
    }
    throw erro;
  }
}

// --- Assinatura -------------------------------------------------------------------------

export const MENSAGEM_ASSINATURA_JA_REGISTRADA = "A assinatura deste contrato já foi registrada — o cliente já está ativo.";

/** Quem registra a assinatura: admin ou o papel Contratos (a rota exige a área "operacao"). */
export async function registrarAssinatura(
  clienteId: string,
  dados: { dataAssinatura: string; pdf: { buffer: Buffer; nome: string } },
  autor: { equipeId: string; papel: string },
  hoje: string
): Promise<ResultadoFechamento<{ versaoContrato: number; tarefaImplantacaoId: string }>> {
  if (autor.papel !== "admin" && autor.papel !== "contratos") return { ok: false, motivo: "nao_encontrado" };
  if (dados.dataAssinatura > hoje) return { ok: false, motivo: "dados_invalidos", campo: "data_assinatura", erro: "A data da assinatura não pode estar no futuro." };

  // Confere ANTES de enviar o PDF (sem travar): cliente existe, aguarda assinatura e tem a tarefa de assinatura aberta.
  const [cliente] = await query<{ status_contrato: string; tarefa: string | null }>(
    `select c.status_contrato,
            (select t.id from tarefa_operacional t where t.cliente_id = c.id and t.tipo = 'contrato_assinatura' and t.status in ('aberta', 'em_andamento')) as tarefa
     from cliente_prefeitura c where c.id = $1`,
    [clienteId]
  );
  if (!cliente) return { ok: false, motivo: "nao_encontrado" };
  if (cliente.status_contrato !== "aguardando_assinatura") return { ok: false, motivo: "conflito", erro: MENSAGEM_ASSINATURA_JA_REGISTRADA };
  if (!cliente.tarefa) return { ok: false, motivo: "conflito", erro: "Não há tarefa de assinatura aberta para este cliente." };

  // 1) PDF pelo armazenamento versionado de sempre — falhou, NADA muda.
  const dataBr = dados.dataAssinatura.split("-").reverse().join("/");
  const versao = await registrarVersaoPdf(ALVO_CONTRATO, clienteId, {
    buffer: dados.pdf.buffer,
    nome: dados.pdf.nome,
    motivo: `Contrato assinado em ${dataBr} (registro da assinatura).`,
    enviadoPor: autor.equipeId
  });
  if (!versao.ok) {
    if (versao.motivo === "bucket") return { ok: false, motivo: "bucket", erro: "Armazenamento indisponível no momento — tente novamente em instantes." };
    if (versao.motivo === "dono_inexistente") return { ok: false, motivo: "nao_encontrado" };
    return { ok: false, motivo: "banco", erro: "Não foi possível registrar o contrato — tente novamente." };
  }

  // 2) Só com o PDF aceito: ativa, registra, conclui a tarefa de assinatura e abre a de implantação — tudo ou nada.
  try {
    return await withTransaction(async (c) => {
      const [travado] = await query<{ status_contrato: string }>(`select status_contrato from cliente_prefeitura where id = $1 for update`, [clienteId], c);
      if (!travado || travado.status_contrato !== "aguardando_assinatura") throw new Recusa({ ok: false, motivo: "conflito", erro: MENSAGEM_ASSINATURA_JA_REGISTRADA });
      await query(`update cliente_prefeitura set status_contrato = 'ativo', data_inicio_contrato = $1 where id = $2`, [dados.dataAssinatura, clienteId], c);
      await query(
        `insert into cliente_evento_contrato (cliente_id, tipo, data_evento, detalhe, equipe_id, origem) values ($1, 'assinatura_registrada', $2, $3, $4, 'painel')`,
        [clienteId, dados.dataAssinatura, `Contrato assinado em ${dataBr} — PDF versão ${versao.versao}. Vigência e cobrança a partir desta data.`, autor.equipeId],
        c
      );
      const [assinatura] = await query<{ id: string }>(
        `update tarefa_operacional set status = 'concluida', concluida_em = now(), concluida_por = $1, responsavel_id = coalesce(responsavel_id, $1)
         where cliente_id = $2 and tipo = 'contrato_assinatura' and status in ('aberta', 'em_andamento') returning id`,
        [autor.equipeId, clienteId],
        c
      );
      if (assinatura) await query(`insert into tarefa_historico (tarefa_id, acao, autor_id, detalhe) values ($1, 'concluida', $2, $3)`, [assinatura.id, autor.equipeId, `Assinatura registrada (${dataBr}).`], c);
      const [implantacao] = await query<{ id: string }>(
        `insert into tarefa_operacional (tipo, cliente_id, papel_responsavel, prazo) values ('implantacao', $1, 'implantacao', $2) returning id`,
        [clienteId, prazoImplantacao(hoje)],
        c
      );
      await query(`insert into tarefa_historico (tarefa_id, acao, autor_id, detalhe) values ($1, 'criada', $2, $3)`, [implantacao.id, autor.equipeId, "Aberta pela assinatura registrada."], c);
      return { ok: true as const, versaoContrato: versao.versao, tarefaImplantacaoId: implantacao.id };
    });
  } catch (erro) {
    if (erro instanceof Recusa) return erro.falha;
    throw erro;
  }
}
