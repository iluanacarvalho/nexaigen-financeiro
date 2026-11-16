// Job diário — varre todas as notas em aberto, recalcula o diagnóstico
// (lib/prazos.ts) e cria alerta_cobranca quando cruzar um limiar.
// Idempotente: não duplica alerta do mesmo tipo já em aberto (constraint
// uq_alerta_ativo no schema garante isso a nível de banco também).
//
// COMO É AGENDADO (rodada 07 — a hospedagem é Railway, não Vercel; o
// vercel.json que existia aqui nunca dispararia fora da Vercel e foi
// removido): .github/workflows/verificar-prazos.yml faz um POST diário
// (09:00 UTC) nesta rota com `Authorization: Bearer ${CRON_SECRET}` e
// imprime no log do Actions o resumo devolvido aqui. Só POST — o GET
// existia só porque o cron da Vercel chama via GET; uma rota que grava
// em lote não deve responder a GET.
// PROTEGIDA SÓ POR CRON_SECRET (lib/segredoCompartilhado.ts, tempo
// constante), nunca por sessão de equipe — quem chama é um agendador
// externo, que não tem como logar (ver app/api/protecao-rotas.test.ts).
//
// RESUMO DEVOLVIDO: notas avaliadas, status atualizados, alertas criados,
// e-mails (enviados / falhos / pulados por cliente sem contato_email) e
// contadores de rate limit expirados removidos (limpeza diária de
// rate_limit_contador, ver lib/rateLimit.ts).
//
// E-MAIL AO CLIENTE (rodada de "e-mails bem lindos e cobrança automática"):
// notificarClientePrefeitura (lib/notificacaoCliente.ts) é chamada pros 4
// tipos de alerta, sempre que o upsert abaixo REALMENTE inseriu uma linha
// nova (`returning id` só traz linha quando o INSERT de fato aconteceu —
// uma linha ignorada por conflito com `on conflict ... do nothing` nunca
// aparece no RETURNING, mesmo efeito de `ignoreDuplicates: true` +
// `.maybeSingle()` do Supabase antes desta rodada de migração de
// infraestrutura). Isso é o mecanismo INTEIRO da regra "só na transição
// de estado, nunca todo dia enquanto o estado persistir" (decisão de
// produto da Luana) — reaproveitando o índice único parcial
// `uq_alerta_ativo` (nota_fiscal_id+tipo, where status <> 'resolvido')
// que já existia pra dar idempotência ao alerta em si. Rodar o job duas
// vezes no mesmo dia (ou todo dia seguinte, enquanto o tipo de alerta não
// mudar) faz o `on conflict ... do nothing` ignorar a segunda tentativa
// silenciosamente, sem devolver linha, e o e-mail ao cliente simplesmente
// não é chamado de novo. Ver o comentário completo em
// lib/notificacaoCliente.ts.
//
// AVISO PRÉVIO (rodada 12-A): ANTES das notas, contratos 'em_aviso_previo'
// cujo término já passou (`termino < hoje` em America/Sao_Paulo — o dia
// do término ainda é dia de contrato) viram 'encerrado' + evento de
// auditoria (lib/cancelamentoServico.ts#encerrarAvisosVencidos), cada
// cliente na sua transação — a falha de um não para os outros nem o resto
// do job (contada no resumo + alerta de sistema). ENCERRAR NÃO CANCELA
// DÍVIDA: a consulta de notas abaixo NÃO filtra pelo status do contrato
// — nota em aberto de cliente 'encerrado' continua sendo avaliada, gera
// alerta e e-mail de cobrança até o pagamento (de propósito; teste de
// integração dedicado em route.integration.test.ts).

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { diagnosticarNota } from "@/lib/prazos";
import { statusPersistidoDe } from "@/lib/estadoNota";
import { notificarTimeDeCobranca } from "@/lib/notificacao-interna";
import { notificarClientePrefeitura } from "@/lib/notificacaoCliente";
import { alertarErroSistema } from "@/lib/alertaErroSistema";
import { bearerConfere } from "@/lib/segredoCompartilhado";
import { limparContadoresExpirados } from "@/lib/rateLimit";
import { encerrarAvisosVencidos } from "@/lib/cancelamentoServico";
import { hojeEmSaoPaulo } from "@/lib/painelFinanceiro";

export async function POST(req: NextRequest) {
  return executar(req);
}

interface ResumoVerificacaoPrazos {
  notasAvaliadas: number;
  statusAtualizados: number;
  alertasCriados: number;
  emails: { enviados: number; falhos: number; semDestinatario: number };
  contadoresRateLimitRemovidos: number;
  /** Contratos em aviso prévio encerrados nesta execução (término já passou) e falhas ao encerrar. */
  contratosEncerrados: number;
  falhasEncerramento: number;
}

interface NotaLinha {
  id: string;
  cliente_id: string;
  numero_nf: string | null;
  valor: string;
  data_emissao: string;
  data_atesto: string | null;
  data_limite_pagamento: string | null;
  status: string;
  cliente: { nome: string; contato_email: string | null };
}

async function executar(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("CRON_SECRET não configurado — recusando execução do job.");
    // Falha de sistema real: sem isto, o job diário inteiro para de
    // rodar (nenhuma nota é verificada, nenhum alerta/notificação sai)
    // até alguém notar manualmente — categoria "job_verificar_prazos".
    await alertarErroSistema("job_verificar_prazos", "CRON_SECRET não configurado — o job diário de verificação de prazos está sendo recusado.");
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  if (!bearerConfere(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const encerramento = await encerrarAvisosVencidos(hojeEmSaoPaulo(new Date()));
  if (encerramento.falhas > 0) {
    await alertarErroSistema(
      "job_verificar_prazos",
      `${encerramento.falhas} contrato(s) em aviso prévio com término vencido NÃO foram encerrados pelo job diário (os demais seguiram normalmente) — ver logs do servidor.`
    );
  }

  // Sem filtro de status_contrato DE PROPÓSITO: nota de cliente encerrado continua sendo cobrada.
  const notas = await query<NotaLinha>(
    `select
       nf.id, nf.cliente_id, nf.numero_nf, nf.valor, nf.data_emissao, nf.data_atesto, nf.data_limite_pagamento, nf.status,
       json_build_object('nome', c.nome, 'contato_email', c.contato_email) as cliente
     from nota_fiscal nf
     join cliente_prefeitura c on c.id = nf.cliente_id
     where nf.status not in ('paga', 'cancelada')`
  );

  const resultado: ResumoVerificacaoPrazos = {
    notasAvaliadas: 0,
    statusAtualizados: 0,
    alertasCriados: 0,
    emails: { enviados: 0, falhos: 0, semDestinatario: 0 },
    contadoresRateLimitRemovidos: 0,
    contratosEncerrados: encerramento.encerrados,
    falhasEncerramento: encerramento.falhas
  };
  const contarEmail = (enviado: boolean) => {
    if (enviado) resultado.emails.enviados += 1;
    else resultado.emails.falhos += 1;
  };

  for (const nota of notas) {
    resultado.notasAvaliadas += 1;

    const diagnostico = diagnosticarNota({
      temAtesto: !!nota.data_atesto,
      temPagamento: false,
      dataEmissao: nota.data_emissao,
      dataAtesto: nota.data_atesto,
      dataLimitePagamento: nota.data_limite_pagamento
    });

    const novoStatus = statusPersistidoDe(diagnostico.statusDerivado);
    if (novoStatus !== nota.status) {
      await query(`update nota_fiscal set status = $1 where id = $2`, [novoStatus, nota.id]);
      resultado.statusAtualizados += 1;
    }

    if (diagnostico.deveGerarAlerta) {
      // `on conflict (nota_fiscal_id, tipo) where status <> 'resolvido'`
      // tem que bater EXATAMENTE com o predicado do índice único parcial
      // uq_alerta_ativo (db/migrations/0001_initial.sql) — é assim que o
      // Postgres identifica qual índice este ON CONFLICT está mirando.
      const criados = await query<{ id: string }>(
        `insert into alerta_cobranca (nota_fiscal_id, tipo, status)
         values ($1, $2, 'pendente')
         on conflict (nota_fiscal_id, tipo) where status <> 'resolvido' do nothing
         returning id`,
        [nota.id, diagnostico.deveGerarAlerta]
      );

      if (criados.length > 0) {
        resultado.alertasCriados += 1;
        if (diagnostico.deveGerarAlerta === "atraso_60_dias") {
          contarEmail(await notificarTimeDeCobranca({
            tipo: diagnostico.deveGerarAlerta,
            clienteNome: nota.cliente?.nome ?? "—",
            numeroNf: nota.numero_nf,
            valor: Number(nota.valor),
            diasDeAtraso: diagnostico.diasDeAtraso
          }));
        }
        // Os 4 tipos, sempre — ver comentário de topo do arquivo sobre
        // por que `criados.length > 0` já é a própria checagem de
        // "transição de estado" (nenhuma coluna de controle extra).
        const contatoEmail = nota.cliente?.contato_email ?? null;
        const enviadoAoCliente = await notificarClientePrefeitura({
          tipo: diagnostico.deveGerarAlerta,
          clienteNome: nota.cliente?.nome ?? "—",
          contatoEmail,
          numeroNf: nota.numero_nf,
          valor: Number(nota.valor),
          dataVencimento: nota.data_limite_pagamento
        });
        // Cliente sem contato_email cadastrado não é falha de envio — é
        // cadastro incompleto (lib/notificacaoCliente.ts nem tenta enviar).
        if (!contatoEmail) resultado.emails.semDestinatario += 1;
        else contarEmail(enviadoAoCliente);
      }
    }
  }

  resultado.contadoresRateLimitRemovidos = await limparContadoresExpirados();

  return NextResponse.json(resultado);
}
