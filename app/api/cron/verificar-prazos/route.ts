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
// PROTEGIDA SÓ POR CRON_SECRET, nunca por sessão de equipe — quem chama
// isto é um agendador externo, que não tem como logar (ver
// app/api/protecao-rotas.test.ts, que confirma explicitamente que esta
// rota nunca passa por exigirSessao()).
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

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
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
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const auth = req.headers.get("authorization");
  const esperado = `Bearer ${process.env.CRON_SECRET}`;
  if (!auth || !segredosIguais(auth, esperado)) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const notas = await query<NotaLinha>(
    `select
       nf.id, nf.cliente_id, nf.numero_nf, nf.valor, nf.data_emissao, nf.data_atesto, nf.data_limite_pagamento, nf.status,
       json_build_object('nome', c.nome, 'contato_email', c.contato_email) as cliente
     from nota_fiscal nf
     join cliente_prefeitura c on c.id = nf.cliente_id
     where nf.status not in ('paga', 'cancelada')`
  );

  const resultado = { processadas: 0, alertasCriados: 0, statusAtualizados: 0 };

  for (const nota of notas) {
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
          await notificarTimeDeCobranca({
            tipo: diagnostico.deveGerarAlerta,
            clienteNome: nota.cliente?.nome ?? "—",
            numeroNf: nota.numero_nf,
            valor: Number(nota.valor),
            diasDeAtraso: diagnostico.diasDeAtraso
          });
        }
        // Os 4 tipos, sempre — ver comentário de topo do arquivo sobre
        // por que `criados.length > 0` já é a própria checagem de
        // "transição de estado" (nenhuma coluna de controle extra).
        await notificarClientePrefeitura({
          tipo: diagnostico.deveGerarAlerta,
          clienteNome: nota.cliente?.nome ?? "—",
          contatoEmail: nota.cliente?.contato_email ?? null,
          numeroNf: nota.numero_nf,
          valor: Number(nota.valor),
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
