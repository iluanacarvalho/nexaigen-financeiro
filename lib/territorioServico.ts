// Lote do Território (rodada 16-A2): "Abrir lead", "Criar leads para os
// selecionados", "Abrir leads de todas as prefeituras ainda não abordadas
// desta entidade" e "Criar leads para todos os resultados ainda não
// abordados" — TODOS por aqui.
//
//   - PRÉVIA (previaLote): quantos serão criados, quais serão pulados e por
//     quê (lib/territorio.ts#motivoParaPular) — nada é gravado;
//   - EXECUÇÃO (criarLeadsEmLote): UMA transação. Cada lead passa pelo MESMO
//     caminho do cadastro manual (lib/crmServico.ts#criarLead: duplicidade de
//     lead aberto e cliente vigente da 16-A/16-A1, índices únicos da 0014) e
//     ganha a linha 'criacao' no histórico dizendo de onde veio. Duplicado
//     descoberto na hora (outra pessoa criou no meio) é PULADO e listado —
//     um SAVEPOINT por lead desfaz só aquela tentativa. Qualquer OUTRO erro
//     desfaz o lote INTEIRO (nenhum lead, nenhum histórico).
//
// Vendas: sempre atribuído a si; só municípios dos estados liberados (a
// leitura já não devolve os outros). Admin escolhe o vendedor.

import { query, withTransaction, type Executor } from "./db";
import { criarLead, registrarCriacao, vendedorValido, MENSAGEM_VENDEDOR_INVALIDO, type ResultadoCrm } from "./crmServico";
import type { EscopoCrm } from "./crmRepositorio";
import { LIMITE_LOTE, motivoParaPular, descreverFiltros, type LinhaTerritorio, type ModoLote } from "./territorio";
import { carregarLinhas } from "./territorioRepositorio";
import { consultarTerritorio } from "./territorioConsulta";

export type AlvoLote =
  | { modo: "selecao"; codigos: string[] }
  | { modo: "nao_abordados"; filtros: Record<string, string>; entidadeId?: string; entidadeNome?: string };

export interface ItemLote {
  codigo_ibge: string;
  nome: string;
  uf: string;
}
export interface PuladoLote extends ItemLote {
  motivo: string;
}
export interface PreviaLote {
  criar: ItemLote[];
  pulados: PuladoLote[];
}

const item = (l: Pick<LinhaTerritorio, "codigo_ibge" | "nome" | "uf">): ItemLote => ({ codigo_ibge: l.codigo_ibge, nome: l.nome, uf: l.uf });

async function planejar(alvo: AlvoLote, leitor: EscopoCrm, hoje: string, executor?: Executor): Promise<PreviaLote & { linhas: LinhaTerritorio[]; origem: string }> {
  const pulados: PuladoLote[] = [];
  let linhas: LinhaTerritorio[];
  let modo: ModoLote;
  let origem: string;
  if (alvo.modo === "selecao") {
    modo = "selecao";
    const codigos = [...new Set(alvo.codigos)];
    linhas = await carregarLinhas({ codigos }, leitor, hoje, executor);
    const achados = new Set(linhas.map((l) => l.codigo_ibge));
    for (const codigo of codigos.filter((c) => !achados.has(c))) pulados.push({ codigo_ibge: codigo, nome: codigo, uf: "", motivo: "município não encontrado na base (ou de estado não liberado)" });
    origem = `Lead aberto pelo Território (${codigos.length === 1 ? "um município" : `seleção de ${codigos.length} prefeituras`}).`;
  } else {
    modo = "nao_abordados";
    const r = await consultarTerritorio(alvo.filtros, leitor, hoje, { entidadeId: alvo.entidadeId }, executor);
    linhas = r.todas;
    const descricao = descreverFiltros(r.filtros, { entidade: alvo.entidadeNome }).slice(0, 600);
    origem = alvo.entidadeId
      ? `Lead aberto pela entidade ${alvo.entidadeNome ?? ""} ("todas as prefeituras ainda não abordadas").`
      : `Lead aberto pelo Território ("todos os resultados ainda não abordados"${descricao ? `: ${descricao}` : ""}).`;
  }
  const criar: LinhaTerritorio[] = [];
  for (const l of linhas) {
    const motivo = motivoParaPular(l, modo);
    if (motivo) pulados.push({ ...item(l), motivo });
    else criar.push(l);
  }
  return { criar: criar.map(item), pulados, linhas: criar, origem };
}

/** Prévia: nada é gravado. */
export async function previaLote(alvo: AlvoLote, leitor: EscopoCrm, hoje: string, executor?: Executor): Promise<PreviaLote> {
  const { criar, pulados } = await planejar(alvo, leitor, hoje, executor);
  return { criar, pulados };
}

/** Executa o lote (uma transação). `vendedorId`: só admin escolhe; vendas = si mesmo. */
export async function criarLeadsEmLote(
  alvo: AlvoLote,
  vendedorId: string | undefined,
  autor: EscopoCrm,
  hoje: string
): Promise<ResultadoCrm<{ criados: (ItemLote & { lead_id: string })[]; pulados: PuladoLote[] }>> {
  const vendedor = vendedorId ?? autor.equipeId;
  if (!autor.admin && vendedor !== autor.equipeId) return { ok: false, motivo: "proibido", erro: "Só um administrador cria leads para outro vendedor — os leads que você cria são seus." };
  return withTransaction(async (c) => {
    if (!(await vendedorValido(c, vendedor))) return { ok: false as const, motivo: "dados_invalidos" as const, campo: "vendedor_id", erro: MENSAGEM_VENDEDOR_INVALIDO };
    const plano = await planejar(alvo, autor, hoje, c);
    // Nada a criar (tudo já é cliente/lead — inclusive porque outra pessoa criou um segundo antes): não é erro; volta a lista de puladas.
    if (plano.linhas.length === 0) return { ok: true as const, criados: [], pulados: plano.pulados };
    if (plano.linhas.length > LIMITE_LOTE) return { ok: false as const, motivo: "dados_invalidos" as const, erro: `No máximo ${LIMITE_LOTE} leads por lote — refine os filtros.` };
    const criados: (ItemLote & { lead_id: string })[] = [];
    const pulados = [...plano.pulados];
    for (const l of plano.linhas) {
      await query("savepoint lote_item", [], c);
      const r = await criarLead(
        {
          municipio_nome: l.nome,
          uf: l.uf,
          codigo_ibge: l.codigo_ibge,
          populacao: l.populacao,
          plano_interesse: null,
          valor_mensal_estimado_centavos: null,
          contato_nome: null,
          contato_cargo: null,
          contato_email: null,
          contato_telefone: null,
          origem: "outro",
          proxima_acao_em: null,
          proxima_acao_descricao: null,
          vendedor_id: vendedor
        },
        autor,
        c
      );
      if (r.ok) {
        await registrarCriacao(c, r.id, autor.equipeId, plano.origem);
        await query("release savepoint lote_item", [], c);
        criados.push({ ...item(l), lead_id: r.id });
      } else {
        // Duplicidade descoberta na hora (lead aberto ou cliente criado por outra pessoa no meio): desfaz SÓ esta tentativa.
        await query("rollback to savepoint lote_item", [], c);
        pulados.push({ ...item(l), motivo: "erro" in r ? r.erro : "não foi possível criar" });
      }
    }
    return { ok: true as const, criados, pulados };
  });
}
