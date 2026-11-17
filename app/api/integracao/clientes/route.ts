// Integração AUTOMÁTICA nexaigen-educa → Financeiro (bancos SEPARADOS,
// sem SSO): depois de provisionar um município novo, o Educa chama esta
// rota pra criar/atualizar o cliente_prefeitura correspondente.
//
// PROTEGIDA SÓ POR INTEGRACAO_SECRET, nunca por sessão de equipe — quem
// chama é o outro sistema, não uma pessoa logada. Mesmo padrão exato do
// CRON_SECRET em app/api/cron/verificar-prazos/route.ts (header
// `Authorization: Bearer <segredo>`, comparação em tempo constante via
// lib/segredoCompartilhado.ts); o valor é o MESMO configurado como
// INTEGRACAO_FINANCEIRO_SECRET no Educa. app/api/protecao-rotas.test.ts
// confirma que esta rota nunca passa por exigirSessao()/exigirPapel().
//
// LIMITES (rodada 07, lib/rateLimit.ts), por IP: 60 requisições/min no
// total, e 10 falhas de autenticação em 15 min → 429 mesmo com o segredo
// certo (a tentativa soma ANTES de comparar e é devolvida se o segredo
// confere — só falha acumula; atômico, sem corrida sob rajada). Resposta
// de falha é sempre o mesmo 401 genérico. Desde a rodada 12-A essa
// barreira inteira é lib/autenticacaoIntegracao.ts (a rota de
// cancelamento usa a mesma).
//
// ALERTA DE SISTEMA (lib/alertaErroSistema.ts, categoria
// "integracao_educa"): INTEGRACAO_SECRET ausente (toda chamada do Educa
// passa a ser recusada — cliente novo nunca chega aqui) e falha ao gravar
// no banco. Segredo ERRADO é só 401, sem alerta (é a própria barreira
// funcionando, e alertar daria a qualquer um um jeito de disparar
// e-mail). Falha de upload do contrato já é alertada pelo próprio
// lib/armazenamentoObjetos.ts (categoria "railway_bucket") — não alertada
// de novo aqui. Nenhuma mensagem de alerta carrega dado do cliente.
//
// IDEMPOTÊNCIA: upsert numa query só por municipio_id_externo, apoiado no
// índice único parcial uq_cliente_municipio_id_externo
// (db/migrations/0004_integracao_educa.sql) — retry do Educa vira UPDATE,
// nunca cliente duplicado, sem a janela de corrida de um
// select-then-insert. O `on conflict ... where municipio_id_externo is not
// null` precisa bater EXATAMENTE com o predicado do índice. No UPDATE, só
// os campos ENVIADOS mudam: opcional ausente (null aqui) mantém o valor
// salvo via coalesce. `(xmax = 0)` no RETURNING distingue INSERT (true) de
// UPDATE (false) — idioma padrão do Postgres pra ON CONFLICT DO UPDATE.
//
// CONTRATO (opcional, base64 no JSON): validado por inteiro ANTES de
// qualquer escrita (base64 válido, ≤10MB decodificado, assinatura
// `%PDF-` — lib/validacaoPdf.ts) — inválido é 400, nunca ignorado em
// silêncio. Desde a rodada 08 o contrato vira uma VERSÃO nova
// (cliente_contrato_versao, 0009 — mesma implementação da tela de
// Clientes, lib/versionamentoPdf.ts), nunca sobrescreve o anterior: o
// cliente é gravado primeiro (upsert), depois a versão. Um upload/registro
// que FALHA não derruba o cadastro — o cliente fica salvo, o contrato
// atual (se havia) continua o mesmo, e a resposta traz `avisoContrato`.
// enviado_por da versão fica nulo (quem envia é o outro sistema) e o
// motivo registra a origem.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { IntegracaoClienteSchema } from "@/lib/clienteSchema";
import { alertarErroSistema } from "@/lib/alertaErroSistema";
import { lerPdfDeBase64 } from "@/lib/validacaoPdf";
import { ALVO_CONTRATO, registrarVersaoPdf } from "@/lib/versionamentoPdf";
import { CATEGORIA_ALERTA_INTEGRACAO, autorizarIntegracao } from "@/lib/autenticacaoIntegracao";
import { detalhesDoErro } from "@/lib/validacao";
import { centavosParaNumeric } from "@/lib/dinheiro";
import { MENSAGEM_DISPENSA_SEM_TAXA, valoresPadrao, type IdPlano } from "@/lib/planos";

const AVISO_CONTRATO = "não foi possível salvar o contrato anexado";

export async function POST(req: NextRequest) {
  const negado = await autorizarIntegracao(req);
  if (negado) return negado;

  const corpo = await req.json().catch(() => null);
  const parsed = IntegracaoClienteSchema.safeParse(corpo);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  const c = parsed.data;

  let contratoPdf: Buffer | null = null;
  if (c.contratoArquivoBase64 !== undefined && c.contratoArquivoNome !== undefined) {
    const pdf = lerPdfDeBase64(c.contratoArquivoBase64);
    if (!pdf.ok) return NextResponse.json({ erro: pdf.erro }, { status: 400 });
    contratoPdf = pdf.buffer;
  }

  // Preço (rodada 11-A, lib/planos.ts). INSERT: plano ausente → 'dispensa' (o mesmo destino que o antigo
  // default 'essencial' teve na migration 0010); valor/taxa ausentes → padrão do plano. UPDATE (reenvio do
  // Educa): ausente MANTÉM o valor salvo; presente sobrescreve — como sempre foi com valorMensal (que o
  // Educa sempre envia: um reenvio dele substitui o valor editado à mão, comportamento preservado).
  // Mudar pra Dispensa sem mandar taxa zera a taxa (Dispensa não tem implantação); taxa enviada com o
  // cliente ficando Dispensa → CHECK do banco → 400 abaixo.
  // Valores do ramo INSERT: o que veio, senão o padrão do plano efetivo. Não dá pra validar aqui "Dispensa sem
  // taxa" pra plano AUSENTE — o mesmo corpo é INSERT (cliente novo, vira Dispensa) ou UPDATE (cliente que já é
  // de porte, taxa legítima); quem decide é o CHECK do banco, traduzido em 400 no catch. Plano Dispensa ENVIADO
  // junto com taxa já foi recusado pelo schema.
  const planoInsert: IdPlano = c.plano ?? "dispensa";
  const padraoInsert = valoresPadrao(planoInsert);
  const valorInsertCentavos = c.valorMensal ?? padraoInsert.valorMensalCentavos;
  const taxaInsertCentavos = c.taxaImplantacao !== undefined ? c.taxaImplantacao : padraoInsert.taxaImplantacaoCentavos;
  const numericOuNull = (centavos: number | null | undefined) => (centavos === undefined || centavos === null ? null : centavosParaNumeric(centavos));

  let linhas: { id: string; criado: boolean }[];
  try {
    linhas = await query<{ id: string; criado: boolean }>(
      `insert into cliente_prefeitura
         (municipio_id_externo, nome, uf, valor_mensal, data_inicio_contrato, plano, dia_vencimento_contrato,
          cnpj, sistema_portal, portal_url, portal_usuario, contato_nome, contato_email, contato_telefone,
          observacao, taxa_implantacao)
       values ($1, $2, $3, $4::numeric, $5, coalesce($6::text, 'dispensa'), coalesce($7::int, 1),
               $8, $9, $10, $11, $12, $13, $14, $15, $17::numeric)
       on conflict (municipio_id_externo) where municipio_id_externo is not null do update set
         nome = excluded.nome,
         uf = excluded.uf,
         valor_mensal = coalesce($16::numeric, cliente_prefeitura.valor_mensal),
         data_inicio_contrato = excluded.data_inicio_contrato,
         plano = coalesce($6::text, cliente_prefeitura.plano),
         dia_vencimento_contrato = coalesce($7::int, cliente_prefeitura.dia_vencimento_contrato),
         taxa_implantacao = case
           when $18::boolean then $19::numeric
           when coalesce($6::text, cliente_prefeitura.plano) = 'dispensa' then null
           else cliente_prefeitura.taxa_implantacao
         end,
         cnpj = coalesce(excluded.cnpj, cliente_prefeitura.cnpj),
         sistema_portal = coalesce(excluded.sistema_portal, cliente_prefeitura.sistema_portal),
         portal_url = coalesce(excluded.portal_url, cliente_prefeitura.portal_url),
         portal_usuario = coalesce(excluded.portal_usuario, cliente_prefeitura.portal_usuario),
         contato_nome = coalesce(excluded.contato_nome, cliente_prefeitura.contato_nome),
         contato_email = coalesce(excluded.contato_email, cliente_prefeitura.contato_email),
         contato_telefone = coalesce(excluded.contato_telefone, cliente_prefeitura.contato_telefone),
         observacao = coalesce(excluded.observacao, cliente_prefeitura.observacao)
       returning id, (xmax = 0) as criado`,
      [
        c.municipioIdExterno,
        c.nome,
        c.uf,
        centavosParaNumeric(valorInsertCentavos),
        c.dataInicioContrato,
        c.plano ?? null,
        c.diaVencimentoContrato ?? null,
        c.cnpj ?? null,
        c.sistemaPortal ?? null,
        c.portalUrl ?? null,
        c.portalUsuario ?? null,
        c.contatoNome ?? null,
        c.contatoEmail ?? null,
        c.contatoTelefone ?? null,
        c.observacao ?? null,
        numericOuNull(c.valorMensal),
        numericOuNull(taxaInsertCentavos),
        c.taxaImplantacao !== undefined,
        numericOuNull(c.taxaImplantacao)
      ]
    );
  } catch (erro) {
    // Taxa enviada pra um cliente que fica Dispensa (plano não veio e o salvo é Dispensa): dado inválido, não falha de sistema.
    const pg = erro as { code?: string; constraint?: string };
    if (pg?.code === "23514" && pg.constraint === "ck_cliente_prefeitura_dispensa_sem_taxa") {
      return NextResponse.json({ erro: "Dados inválidos", detalhes: { formErrors: [MENSAGEM_DISPENSA_SEM_TAXA], fieldErrors: {} } }, { status: 400 });
    }
    // Nunca loga o erro cru (pode ecoar valores da linha) — só o código do pg.
    const codigo = (erro as { code?: string } | null)?.code ?? "desconhecido";
    console.error(`[integracao-educa] falha ao gravar cliente_prefeitura — código pg: ${codigo}.`);
    await alertarErroSistema(
      CATEGORIA_ALERTA_INTEGRACAO,
      `Falha ao gravar cliente vindo da integração com o nexaigen-educa (upsert em cliente_prefeitura, código pg: ${codigo}).`
    );
    return NextResponse.json({ erro: "Falha ao gravar o cliente — tente novamente em instantes." }, { status: 500 });
  }

  const { id, criado } = linhas[0];
  if (!contratoPdf) return NextResponse.json({ id, criado });

  const versao = await registrarVersaoPdf(ALVO_CONTRATO, id, {
    buffer: contratoPdf,
    nome: c.contratoArquivoNome!,
    motivo: "Enviado pela integração com o nexaigen-educa.",
    enviadoPor: null
  });
  return NextResponse.json(versao.ok ? { id, criado, versaoContrato: versao.versao } : { id, criado, avisoContrato: AVISO_CONTRATO });
}
