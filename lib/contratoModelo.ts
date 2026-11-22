// Modelo de contrato → contrato do cliente (rodada 16-B1). Funções PURAS.
//
// FORMATO DO TEXTO DO MODELO (o admin edita na tela /modelos-contrato):
//   - "# Título" e "## Subtítulo" no começo da linha;
//   - linha em branco separa parágrafos; dentro do parágrafo, quebra de
//     linha é mantida;
//   - **negrito** dentro do texto;
//   - campos {{nome_do_campo}} — LISTA FECHADA (CAMPOS_MODELO). Campo
//     desconhecido é erro ao SALVAR o modelo (validarModelo), nunca
//     descoberto só na hora de gerar.
// Parágrafo que usa a taxa de implantação some INTEIRO quando o cliente não
// tem taxa (Dispensa, ou taxa não combinada) — nunca sai "R$ ()".
// Dado OBRIGATÓRIO faltando no cliente = erro listando exatamente quais
// (renderizarModelo → { ok: false, faltando }).

import { formatarCep, formatarCnpj } from "./cnpj";
import { dataPorExtenso, formatarReais, valorPorExtenso } from "./extenso";
import { rotuloDoPlano } from "./planos";

export interface CampoModelo {
  campo: string;
  descricao: string;
  /** Faltando no cliente → o contrato NÃO é gerado (lista o que falta). */
  obrigatorio: boolean;
}

export const CAMPOS_MODELO: readonly CampoModelo[] = [
  { campo: "municipio_nome", descricao: "Nome do município (base do IBGE)", obrigatorio: true },
  { campo: "uf", descricao: "UF", obrigatorio: true },
  { campo: "codigo_ibge", descricao: "Código IBGE do município", obrigatorio: true },
  { campo: "cnpj", descricao: "CNPJ da prefeitura, formatado (12.345.678/0001-95)", obrigatorio: true },
  { campo: "endereco_completo", descricao: "Endereço: logradouro, número, complemento, bairro, município — UF, CEP", obrigatorio: true },
  { campo: "representante_nome", descricao: "Representante legal — nome", obrigatorio: true },
  { campo: "representante_cargo", descricao: "Representante legal — cargo", obrigatorio: true },
  { campo: "plano_rotulo", descricao: "Plano contratado (ex.: Pequeno Porte)", obrigatorio: true },
  { campo: "valor_mensal", descricao: "Mensalidade (R$ 8.500,00)", obrigatorio: true },
  { campo: "valor_mensal_extenso", descricao: "Mensalidade por extenso", obrigatorio: true },
  { campo: "taxa_implantacao", descricao: "Taxa de implantação (R$) — o PARÁGRAFO some se não houver", obrigatorio: false },
  { campo: "taxa_implantacao_extenso", descricao: "Taxa de implantação por extenso — o PARÁGRAFO some se não houver", obrigatorio: false },
  { campo: "data_assinatura", descricao: 'Data da assinatura por extenso, ou "____ de ________ de ____" se ainda não assinado', obrigatorio: false },
  { campo: "contato_nome", descricao: "Contato operacional — nome", obrigatorio: true },
  { campo: "contato_cargo", descricao: "Contato operacional — cargo", obrigatorio: true },
  { campo: "contato_email", descricao: "Contato operacional — e-mail", obrigatorio: true },
  { campo: "contato_telefone", descricao: "Contato operacional — telefone", obrigatorio: true },
  { campo: "data_geracao", descricao: "Data em que o documento foi gerado (dd/mm/aaaa)", obrigatorio: false }
];

const NOMES_CAMPOS = new Set(CAMPOS_MODELO.map((c) => c.campo));
const CAMPOS_DA_TAXA = new Set(["taxa_implantacao", "taxa_implantacao_extenso"]);
export const DATA_EM_BRANCO = "____ de ________ de ____";

const PADRAO_CAMPO = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Campos usados no texto (na ordem em que aparecem, sem repetição). */
export function camposDoTexto(conteudo: string): string[] {
  return [...new Set([...conteudo.matchAll(PADRAO_CAMPO)].map((m) => m[1]))];
}

/**
 * Valida o texto do modelo ANTES de salvar: campo desconhecido ou chaves
 * soltas ("{{" sem "}}") são erro. Devolve todos os problemas de uma vez.
 */
export function validarModelo(conteudo: string): { ok: true; campos: string[] } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  if (conteudo.trim() === "") erros.push("O modelo está vazio.");
  const campos = camposDoTexto(conteudo);
  const desconhecidos = campos.filter((c) => !NOMES_CAMPOS.has(c));
  if (desconhecidos.length) erros.push(`Campo(s) desconhecido(s): ${desconhecidos.map((c) => `{{${c}}}`).join(", ")}. Use só os da lista de campos disponíveis.`);
  const semCampos = conteudo.replace(PADRAO_CAMPO, "");
  if (semCampos.includes("{{") || semCampos.includes("}}")) erros.push('Há chaves "{{" ou "}}" soltas no texto — todo campo é {{nome_do_campo}}.');
  return erros.length ? { ok: false, erros } : { ok: true, campos };
}

// --- Dados do cliente ------------------------------------------------------------------

export interface DadosContrato {
  municipio_nome: string | null;
  uf: string | null;
  codigo_ibge: string | null;
  cnpj: string | null;
  endereco_logradouro: string | null;
  endereco_numero: string | null;
  endereco_complemento: string | null;
  endereco_bairro: string | null;
  endereco_cep: string | null;
  representante_nome: string | null;
  representante_cargo: string | null;
  plano: string | null;
  valor_mensal_centavos: number | null;
  taxa_implantacao_centavos: number | null;
  /** aaaa-mm-dd, ou null (ainda não assinado). */
  data_assinatura: string | null;
  contato_nome: string | null;
  contato_cargo: string | null;
  contato_email: string | null;
  contato_telefone: string | null;
  /** aaaa-mm-dd (America/Sao_Paulo). */
  data_geracao: string;
}

const vazio = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";

/** Valor de cada campo; null = dado faltando no cliente. */
export function valoresDosCampos(d: DadosContrato): Record<string, string | null> {
  const enderecoIncompleto = [d.endereco_logradouro, d.endereco_numero, d.endereco_bairro, d.endereco_cep, d.municipio_nome, d.uf].some(vazio);
  return {
    municipio_nome: vazio(d.municipio_nome) ? null : d.municipio_nome,
    uf: vazio(d.uf) ? null : d.uf,
    codigo_ibge: vazio(d.codigo_ibge) ? null : d.codigo_ibge,
    cnpj: vazio(d.cnpj) ? null : formatarCnpj(d.cnpj!),
    endereco_completo: enderecoIncompleto
      ? null
      : [d.endereco_logradouro, d.endereco_numero, d.endereco_complemento, d.endereco_bairro].filter((p) => !vazio(p)).join(", ") +
        `, ${d.municipio_nome} — ${d.uf}, CEP ${formatarCep(d.endereco_cep!)}`,
    representante_nome: vazio(d.representante_nome) ? null : d.representante_nome,
    representante_cargo: vazio(d.representante_cargo) ? null : d.representante_cargo,
    plano_rotulo: vazio(d.plano) ? null : rotuloDoPlano(d.plano!),
    valor_mensal: d.valor_mensal_centavos === null ? null : formatarReais(d.valor_mensal_centavos),
    valor_mensal_extenso: d.valor_mensal_centavos === null ? null : valorPorExtenso(d.valor_mensal_centavos),
    taxa_implantacao: d.taxa_implantacao_centavos === null ? "" : formatarReais(d.taxa_implantacao_centavos),
    taxa_implantacao_extenso: d.taxa_implantacao_centavos === null ? "" : valorPorExtenso(d.taxa_implantacao_centavos),
    data_assinatura: d.data_assinatura ? dataPorExtenso(d.data_assinatura) : DATA_EM_BRANCO,
    contato_nome: vazio(d.contato_nome) ? null : d.contato_nome,
    contato_cargo: vazio(d.contato_cargo) ? null : d.contato_cargo,
    contato_email: vazio(d.contato_email) ? null : d.contato_email,
    contato_telefone: vazio(d.contato_telefone) ? null : d.contato_telefone,
    data_geracao: d.data_geracao.split("-").reverse().join("/")
  };
}

// --- Renderização ------------------------------------------------------------------------

export interface TrechoTexto {
  texto: string;
  negrito: boolean;
}
export interface Bloco {
  tipo: "titulo" | "subtitulo" | "paragrafo";
  /** Linhas do bloco (quebra de linha dentro do parágrafo), cada uma em trechos. */
  linhas: TrechoTexto[][];
}

function trechos(linha: string): TrechoTexto[] {
  const saida: TrechoTexto[] = [];
  linha.split(/(\*\*[^*]+\*\*)/g).forEach((parte) => {
    if (parte === "") return;
    const negrito = parte.startsWith("**") && parte.endsWith("**") && parte.length > 4;
    saida.push({ texto: negrito ? parte.slice(2, -2) : parte, negrito });
  });
  return saida;
}

export type ResultadoRenderizacao = { ok: true; blocos: Bloco[] } | { ok: false; faltando: string[] };

/**
 * Preenche o modelo com os dados do cliente. Campos obrigatórios USADOS no
 * texto e faltando no cliente → { ok: false, faltando: [descrições] }.
 * Parágrafos que usam a taxa somem quando não há taxa.
 */
export function renderizarModelo(conteudo: string, dados: DadosContrato): ResultadoRenderizacao {
  const valores = valoresDosCampos(dados);
  const usados = camposDoTexto(conteudo);
  const faltando = CAMPOS_MODELO.filter((c) => c.obrigatorio && usados.includes(c.campo) && valores[c.campo] === null).map((c) => c.descricao);
  if (faltando.length) return { ok: false, faltando };
  const semTaxa = dados.taxa_implantacao_centavos === null;

  const blocos: Bloco[] = [];
  for (const bruto of conteudo.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    if (bruto.trim() === "") continue;
    if (semTaxa && camposDoTexto(bruto).some((c) => CAMPOS_DA_TAXA.has(c))) continue;
    const preenchido = bruto.replace(PADRAO_CAMPO, (_, campo: string) => valores[campo] ?? "");
    const linhas = preenchido.split("\n").map((l) => l.trimEnd());
    const primeira = linhas[0].trimStart();
    if (linhas.length === 1 && primeira.startsWith("## ")) blocos.push({ tipo: "subtitulo", linhas: [trechos(primeira.slice(3).trim())] });
    else if (linhas.length === 1 && primeira.startsWith("# ")) blocos.push({ tipo: "titulo", linhas: [trechos(primeira.slice(2).trim())] });
    else blocos.push({ tipo: "paragrafo", linhas: linhas.map((l) => trechos(l.trim())) });
  }
  return { ok: true, blocos };
}

/** Texto corrido dos blocos (pré-visualização e testes). */
export function textoDosBlocos(blocos: Bloco[]): string {
  return blocos.map((b) => b.linhas.map((l) => l.map((t) => t.texto).join("")).join("\n")).join("\n\n");
}

// --- Faixa e rodapé -----------------------------------------------------------------------

export interface ModeloUsado {
  plano: string;
  versao: number;
  status: "rascunho" | "aprovado";
}

/** Faixa em TODAS as páginas (cabeçalho) quando o modelo é RASCUNHO; null quando aprovado. */
export function faixaDeRascunho(m: ModeloUsado): string | null {
  return m.status === "rascunho" ? `RASCUNHO — SEM VALIDADE JURÍDICA — modelo v${m.versao} do plano ${rotuloDoPlano(m.plano)}` : null;
}

export function rodapeDoContrato(m: ModeloUsado, dataGeracao: string): string {
  return `Gerado em ${dataGeracao.split("-").reverse().join("/")} pela plataforma NEXAIGEN, modelo ${rotuloDoPlano(m.plano)} v${m.versao}.`;
}

/** Dados de EXEMPLO pra pré-visualização do modelo na tela do admin (fictícios, claramente de exemplo). */
export function dadosDeExemplo(plano: string, dataGeracao: string): DadosContrato {
  return {
    municipio_nome: "Exemplópolis",
    uf: "PR",
    codigo_ibge: "4100000",
    cnpj: "11222333000181",
    endereco_logradouro: "Rua do Exemplo",
    endereco_numero: "100",
    endereco_complemento: null,
    endereco_bairro: "Centro",
    endereco_cep: "80000000",
    representante_nome: "Nome do Prefeito (exemplo)",
    representante_cargo: "Prefeito Municipal",
    plano,
    valor_mensal_centavos: plano === "dispensa" ? 545700 : 850000,
    taxa_implantacao_centavos: plano === "dispensa" ? null : 1500000,
    data_assinatura: null,
    contato_nome: "Contato de Exemplo",
    contato_cargo: "Secretário(a) de Educação",
    contato_email: "contato@exemplo.invalid",
    contato_telefone: "(00) 0000-0000",
    data_geracao: dataGeracao
  };
}
