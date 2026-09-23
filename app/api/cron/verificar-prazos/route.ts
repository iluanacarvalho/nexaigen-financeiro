// Job diário — varre todas as notas em aberto, recalcula o diagnóstico
// (lib/prazos.ts) e cria alerta_cobranca quando cruzar um limiar.
// Idempotente: não duplica alerta do mesmo tipo já em aberto (constraint
// uq_alerta_ativo no schema garante isso a nível de banco também).
//
// Como agendar: Vercel Cron (vercel.json) chama esta rota 1x/dia via GET,
// e injeta automaticamente o header Authorization: Bearer ${CRON_SECRET}
// quando a env var CRON_SECRET está configurada no projeto Vercel — ver
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
// POST fica disponível para disparo manual/teste com o mesmo header.
//
// E-MAIL AO CLIENTE (rodada de "e-mails bem lindos e cobrança automática"):
// notificarClientePrefeitura (lib/notificacaoCliente.ts) é chamada pros 4
// tipos de alerta, sempre que `alertaData` vier truthy — ou seja, só
// quando o upsert em alerta_cobranca abaixo REALMENTE inseriu uma linha
// nova. Isso é o mecanismo INTEIRO da regra "só na transição de estado,
// nunca todo dia enquanto o estado persistir" (decisão de produto da
// Luana) — reaproveitando o índice único parcial `uq_alerta_ativo`
// (nota_fiscal_id+tipo, where status <> 'resolvido') que já existia pra
// dar idempotência ao alerta em si. Rodar o job duas vezes no mesmo dia
// (ou todo dia seguinte, enquanto o tipo de alerta não mudar) faz o
// upsert ignorar a segunda tentativa silenciosamente (`ignoreDuplicates:
// true`), então `alertaData` vem null e nenhum e-mail novo é disparado —
// nenhuma coluna de controle extra (`ultimo_alerta_cliente_enviado` ou
// similar) foi necessária. Ver o comentário completo em
// lib/notificacaoCliente.ts.

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { diagnosticarNota } from "@/lib/prazos";
import { notificarTimeDeCobranca } from "@/lib/notificacao-interna";
import { notificarClientePrefeitura } from "@/lib/notificacaoCliente";

export async function GET(req: NextRequest) {
  return executar(req);
}

export async function POST(req: NextRequest) {
  return executar(req);
}

// CORREÇÃO DE SEGURANÇA (Análise Técnica, Achado Baixo): comparação em
// tempo constante — evita timing attack na checagem do CRON_SECRET.
// Buffers de tamanho diferente nunca são iguais e são rejeitados antes de
// chegar em timingSafeEqual (que lança exceção se os tamanhos diferem).
function segredosIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function executar(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("CRON_SECRET não configurado — recusando execução do job.");
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const auth = req.headers.get("authorization");
  const esperado = `Bearer ${process.env.CRON_SECRET}`;
  if (!auth || !segredosIguais(auth, esperado)) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const supabase = supabaseAdmin();

  const { data: notas, error } = await supabase
    .from("nota_fiscal")
    .select(
      "id, cliente_id, numero_nf, valor, data_emissao, data_atesto, data_limite_pagamento, status, cliente:cliente_id ( nome, contato_email )"
    )
    .not("status", "in", "(paga,cancelada)");

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const resultado = { processadas: 0, alertasCriados: 0, statusAtualizados: 0 };

  for (const nota of notas ?? []) {
    resultado.processadas += 1;

    const diagnostico = diagnosticarNota({
      temAtesto: !!nota.data_atesto,
      temPagamento: false,
      dataEmissao: nota.data_emissao,
      dataAtesto: nota.data_atesto,
      dataLimitePagamento: nota.data_limite_pagamento
    });

    const novoStatus = mapearStatus(diagnostico.statusDerivado);
    if (novoStatus !== nota.status) {
      await supabase.from("nota_fiscal").update({ status: novoStatus }).eq("id", nota.id);
      resultado.statusAtualizados += 1;
    }

    if (diagnostico.deveGerarAlerta) {
      const { error: alertaError, data: alertaData } = await supabase
        .from("alerta_cobranca")
        .upsert(
          { nota_fiscal_id: nota.id, tipo: diagnostico.deveGerarAlerta, status: "pendente" },
          { onConflict: "nota_fiscal_id,tipo", ignoreDuplicates: true }
        )
        .select("id")
        .maybeSingle();

      if (!alertaError && alertaData) {
        resultado.alertasCriados += 1;
        if (diagnostico.deveGerarAlerta === "atraso_60_dias") {
          await notificarTimeDeCobranca({
            tipo: diagnostico.deveGerarAlerta,
            clienteNome: (nota.cliente as any)?.nome ?? "—",
            numeroNf: nota.numero_nf,
            valor: nota.valor,
            diasDeAtraso: diagnostico.diasDeAtraso
          });
        }
        // Os 4 tipos, sempre — ver comentário de topo do arquivo sobre
        // por que `alertaData` truthy já é a própria checagem de
        // "transição de estado" (nenhuma coluna de controle extra).
        await notificarClientePrefeitura({
          tipo: diagnostico.deveGerarAlerta,
          clienteNome: (nota.cliente as any)?.nome ?? "—",
          contatoEmail: (nota.cliente as any)?.contato_email ?? null,
          numeroNf: nota.numero_nf,
          valor: nota.valor,
          dataVencimento: nota.data_limite_pagamento
        });
      }
    }
  }

  return NextResponse.json(resultado);
}

function mapearStatus(statusDerivado: string): string {
  const mapa: Record<string, string> = {
    aguardando_atesto: "aguardando_atesto",
    atesto_atrasado: "aguardando_atesto",
    atestada_aguardando_pagamento: "atestada",
    vencendo_em_breve: "atestada",
    vencida: "vencida",
    atraso_critico: "atraso_critico",
    paga: "paga"
  };
  return mapa[statusDerivado] ?? "emitida";
}
