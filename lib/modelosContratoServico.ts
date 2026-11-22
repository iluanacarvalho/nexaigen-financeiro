// Modelos de contrato (rodada 16-B1) — leitura, nova versão, aprovação e a
// GERAÇÃO do contrato do cliente.
//
// VERSÕES IMUTÁVEIS (trigger da 0017): "editar" = criar uma versão NOVA em
// rascunho; a anterior nunca muda; nada é apagado. Aprovar = rascunho →
// aprovado, com quem e quando (só admin — a rota exige a área
// modelos_contrato). Campo desconhecido no texto é recusado ao SALVAR
// (lib/contratoModelo.ts#validarModelo).
//
// GERAR (gerarContratoDoCliente): usa o modelo APROVADO mais recente do
// plano do cliente; sem aprovado, o RASCUNHO mais recente (o documento sai
// com a faixa "RASCUNHO — SEM VALIDADE JURÍDICA" em todas as páginas).
// Dado obrigatório faltando no cliente → erro listando exatamente quais.
// Registra o evento 'contrato_gerado' com o modelo usado. Nada é guardado
// em disco nem no bucket: o .docx é montado na hora e devolvido.

import { query, withTransaction, type Executor } from "./db";
import { faixaDeRascunho, renderizarModelo, rodapeDoContrato, validarModelo, type DadosContrato } from "./contratoModelo";
import { gerarDocx } from "./docx";
import { rotuloDoPlano } from "./planos";

export interface ModeloContrato {
  id: string;
  plano: string;
  versao: number;
  titulo: string;
  conteudo: string;
  status: "rascunho" | "aprovado";
  criado_em: string;
  criado_por_nome: string | null;
  aprovado_em: string | null;
  aprovado_por_nome: string | null;
}

export async function listarModelos(executor?: Executor): Promise<ModeloContrato[]> {
  return query<ModeloContrato>(
    `select m.id, m.plano, m.versao, m.titulo, m.conteudo, m.status, m.criado_em, cp.nome as criado_por_nome, m.aprovado_em, ap.nome as aprovado_por_nome
     from contrato_modelo m
     left join equipe_nexaigen cp on cp.id = m.criado_por
     left join equipe_nexaigen ap on ap.id = m.aprovado_por
     order by array_position(array['dispensa','pequeno_porte','medio_porte','grande_porte']::text[], m.plano), m.versao desc`,
    [],
    executor
  );
}

export type ResultadoModelo<T = object> = ({ ok: true } & T) | { ok: false; motivo: "nao_encontrado" } | { ok: false; motivo: "conflito" | "dados_invalidos"; erro: string };

/** Nova versão em RASCUNHO (a próxima do plano). Texto com campo desconhecido → recusado. */
export async function criarVersaoModelo(dados: { plano: string; titulo: string; conteudo: string }, autorId: string, executor?: Executor): Promise<ResultadoModelo<{ id: string; versao: number }>> {
  const v = validarModelo(dados.conteudo);
  if (!v.ok) return { ok: false, motivo: "dados_invalidos", erro: v.erros.join(" ") };
  try {
    const [linha] = await query<{ id: string; versao: number }>(
      `insert into contrato_modelo (plano, versao, titulo, conteudo, criado_por)
       select $1, coalesce(max(versao), 0) + 1, $2, $3, $4 from contrato_modelo where plano = $1
       returning id, versao`,
      [dados.plano, dados.titulo.trim(), dados.conteudo, autorId],
      executor
    );
    return { ok: true, id: linha.id, versao: linha.versao };
  } catch (erro) {
    const pg = erro as { code?: string; constraint?: string };
    // Duas versões do mesmo plano salvas ao mesmo tempo: a segunda bate no UNIQUE (plano, versao).
    if (pg?.code === "23505" && pg.constraint === "uq_contrato_modelo_plano_versao") return { ok: false, motivo: "conflito", erro: "Outra pessoa salvou uma versão deste plano agora — recarregue e confira." };
    throw erro;
  }
}

/** Aprova um RASCUNHO (registra quem e quando). Já aprovado → 409. */
export async function aprovarModelo(id: string, autorId: string, executor?: Executor): Promise<ResultadoModelo<{ plano: string; versao: number }>> {
  const fazer = async (c: Executor): Promise<ResultadoModelo<{ plano: string; versao: number }>> => {
    const [m] = await query<{ status: string; plano: string; versao: number; conteudo: string }>(`select status, plano, versao, conteudo from contrato_modelo where id = $1 for update`, [id], c);
    if (!m) return { ok: false, motivo: "nao_encontrado" };
    if (m.status === "aprovado") return { ok: false, motivo: "conflito", erro: `A versão ${m.versao} de ${rotuloDoPlano(m.plano)} já está aprovada.` };
    // O seed provisório (0017) foi validado na mão; uma versão salva pela tela já passou por validarModelo. Mesmo assim, confere.
    const v = validarModelo(m.conteudo);
    if (!v.ok) return { ok: false, motivo: "dados_invalidos", erro: v.erros.join(" ") };
    await query(`update contrato_modelo set status = 'aprovado', aprovado_em = now(), aprovado_por = $1 where id = $2`, [autorId, id], c);
    return { ok: true, plano: m.plano, versao: m.versao };
  };
  return executor ? fazer(executor) : withTransaction(fazer);
}

/** O modelo que a geração usa pro plano: o APROVADO mais recente; senão, o RASCUNHO mais recente. */
export async function modeloParaGerar(plano: string, executor?: Executor): Promise<Pick<ModeloContrato, "id" | "plano" | "versao" | "status" | "conteudo" | "titulo"> | null> {
  const [m] = await query<Pick<ModeloContrato, "id" | "plano" | "versao" | "status" | "conteudo" | "titulo">>(
    `select id, plano, versao, status, conteudo, titulo from contrato_modelo where plano = $1
     order by (status = 'aprovado') desc, versao desc limit 1`,
    [plano],
    executor
  );
  return m ?? null;
}

// --- Gerar o contrato do cliente --------------------------------------------------------------

export type ResultadoGeracao =
  | { ok: true; arquivo: Buffer; nomeArquivo: string; modelo: { plano: string; versao: number; status: string } }
  | { ok: false; motivo: "nao_encontrado" }
  | { ok: false; motivo: "conflito"; erro: string }
  | { ok: false; motivo: "dados_faltando"; erro: string; faltando: string[] };

export interface LeitorContrato {
  equipeId: string;
  papel: string;
}

/**
 * Gera o .docx do contrato do cliente. Admin e Contratos: qualquer cliente;
 * Vendas: só o cliente do SEU fechamento (o lead de origem é dele) — de
 * outro, "não existe" (404).
 */
export async function gerarContratoDoCliente(clienteId: string, leitor: LeitorContrato, hoje: string, executor?: Executor): Promise<ResultadoGeracao> {
  const [c] = await query<{
    nome: string;
    uf: string;
    codigo_ibge: string | null;
    municipio_base: string | null;
    cnpj: string | null;
    endereco_logradouro: string | null;
    endereco_numero: string | null;
    endereco_complemento: string | null;
    endereco_bairro: string | null;
    endereco_cep: string | null;
    representante_nome: string | null;
    representante_cargo: string | null;
    plano: string;
    valor_mensal: string;
    taxa_implantacao: string | null;
    status_contrato: string;
    data_inicio_contrato: string | null;
    contato_nome: string | null;
    contato_cargo: string | null;
    contato_email: string | null;
    contato_telefone: string | null;
    vendedor_id: string | null;
  }>(
    `select c.nome, c.uf, c.codigo_ibge, m.nome as municipio_base, c.cnpj, c.endereco_logradouro, c.endereco_numero, c.endereco_complemento,
            c.endereco_bairro, c.endereco_cep, c.representante_nome, c.representante_cargo, c.plano, c.valor_mensal, c.taxa_implantacao,
            c.status_contrato, c.data_inicio_contrato, c.contato_nome, c.contato_cargo, c.contato_email, c.contato_telefone, l.vendedor_id
     from cliente_prefeitura c
     left join municipio_base m on m.codigo_ibge = c.codigo_ibge
     left join lead l on l.id = c.lead_id
     where c.id = $1`,
    [clienteId],
    executor
  );
  if (!c) return { ok: false, motivo: "nao_encontrado" };
  if (leitor.papel === "vendas" && c.vendedor_id !== leitor.equipeId) return { ok: false, motivo: "nao_encontrado" };
  if (leitor.papel !== "admin" && leitor.papel !== "contratos" && leitor.papel !== "vendas") return { ok: false, motivo: "nao_encontrado" };

  const modelo = await modeloParaGerar(c.plano, executor);
  if (!modelo) return { ok: false, motivo: "conflito", erro: `Não há modelo de contrato para o plano ${rotuloDoPlano(c.plano)}.` };

  const centavos = (n: string) => Math.round(Number(n) * 100); // numeric(12,2): sempre 2 casas
  const dados: DadosContrato = {
    municipio_nome: c.municipio_base ?? c.nome.replace(/^Prefeitura (Municipal )?de /i, ""),
    uf: c.uf,
    codigo_ibge: c.codigo_ibge,
    cnpj: c.cnpj,
    endereco_logradouro: c.endereco_logradouro,
    endereco_numero: c.endereco_numero,
    endereco_complemento: c.endereco_complemento,
    endereco_bairro: c.endereco_bairro,
    endereco_cep: c.endereco_cep,
    representante_nome: c.representante_nome,
    representante_cargo: c.representante_cargo,
    plano: c.plano,
    valor_mensal_centavos: centavos(c.valor_mensal),
    taxa_implantacao_centavos: c.taxa_implantacao === null ? null : centavos(c.taxa_implantacao),
    // Assinado (ativo, em aviso…): a data de início É a data da assinatura (16-B1). Aguardando: em branco.
    data_assinatura: c.status_contrato === "aguardando_assinatura" ? null : c.data_inicio_contrato,
    contato_nome: c.contato_nome,
    contato_cargo: c.contato_cargo,
    contato_email: c.contato_email,
    contato_telefone: c.contato_telefone,
    data_geracao: hoje
  };
  const r = renderizarModelo(modelo.conteudo, dados);
  if (!r.ok) return { ok: false, motivo: "dados_faltando", erro: `Faltam dados do cliente para gerar o contrato: ${r.faltando.join("; ")}.`, faltando: r.faltando };

  const usado = { plano: modelo.plano, versao: modelo.versao, status: modelo.status };
  const arquivo = gerarDocx({ blocos: r.blocos, cabecalho: faixaDeRascunho(usado), rodape: rodapeDoContrato(usado, hoje) });
  await query(
    `insert into cliente_evento_contrato (cliente_id, tipo, data_evento, detalhe, equipe_id, origem, modelo_contrato_id)
     values ($1, 'contrato_gerado', $2, $3, $4, 'painel', $5)`,
    [clienteId, hoje, `Contrato gerado do modelo ${rotuloDoPlano(modelo.plano)} v${modelo.versao} (${modelo.status}).`, leitor.equipeId, modelo.id],
    executor
  );
  const slug = dados.municipio_nome!.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return { ok: true, arquivo, nomeArquivo: `contrato-${slug}-${c.uf.toLowerCase()}${modelo.status === "rascunho" ? "-RASCUNHO" : ""}.docx`, modelo: usado };
}
