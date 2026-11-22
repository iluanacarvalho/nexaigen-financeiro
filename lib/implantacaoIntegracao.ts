// Dados da IMPLANTAÇÃO pro nexaigen-educa (rodada 16-B1; consumido pela
// 16-B2 pra pré-preencher o assistente de provisionamento). Só o
// necessário: nome, UF, código IBGE, plano, contato do gestor, data da
// assinatura e status. NADA financeiro, nada de CNPJ, endereço ou
// representante. Objeto montado CHAVE A CHAVE (o teste confere as chaves
// exatas).
//
// Chave da busca: o uuid do município no Educa (municipio_id_externo) OU o
// código IBGE (7 dígitos) — no fechamento o cliente nasce só com o código.
// Cliente ainda 'aguardando_assinatura' → a implantação não começa (a rota
// responde 409).

import { query, type Executor } from "./db";
import { codigoIbgeValido } from "./ibge";
import { ehUuid } from "./validacao";

export interface DadosImplantacao {
  nome: string;
  uf: string;
  codigo_ibge: string | null;
  plano: string;
  contato: { nome: string | null; cargo: string | null; email: string | null; telefone: string | null };
  data_assinatura: string | null;
  status: string;
}

export type ResultadoImplantacao = { ok: true; dados: DadosImplantacao } | { ok: false; motivo: "chave_invalida" | "nao_encontrado" | "aguardando_assinatura" };

export async function dadosParaImplantacao(chave: string, executor?: Executor): Promise<ResultadoImplantacao> {
  const porCodigo = codigoIbgeValido(chave);
  if (!porCodigo && !ehUuid(chave)) return { ok: false, motivo: "chave_invalida" };
  const [c] = await query<{
    nome: string;
    uf: string;
    codigo_ibge: string | null;
    plano: string;
    contato_nome: string | null;
    contato_cargo: string | null;
    contato_email: string | null;
    contato_telefone: string | null;
    data_inicio_contrato: string | null;
    status_contrato: string;
  }>(
    `select nome, uf, codigo_ibge, plano, contato_nome, contato_cargo, contato_email, contato_telefone, data_inicio_contrato, status_contrato
     from cliente_prefeitura where ${porCodigo ? "codigo_ibge = $1" : "municipio_id_externo = $1::uuid"}`,
    [chave],
    executor
  );
  if (!c) return { ok: false, motivo: "nao_encontrado" };
  if (c.status_contrato === "aguardando_assinatura") return { ok: false, motivo: "aguardando_assinatura" };
  return {
    ok: true,
    dados: {
      nome: c.nome,
      uf: c.uf,
      codigo_ibge: c.codigo_ibge,
      plano: c.plano,
      contato: { nome: c.contato_nome, cargo: c.contato_cargo, email: c.contato_email, telefone: c.contato_telefone },
      // Desde a 16-B1 a vigência começa na assinatura: data de início do contrato = data da assinatura.
      data_assinatura: c.data_inicio_contrato,
      status: c.status_contrato
    }
  };
}
