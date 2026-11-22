// lib/fechamento.ts (prazos, selos, prévia) e lib/fechamentoSchemas.ts (aceite estrito, ações de tarefa).

import { describe, expect, it } from "vitest";
import { PAPEL_DO_TIPO, PRAZO_ASSINATURA_DIAS, PRAZO_IMPLANTACAO_DIAS, nomeDoCliente, prazoAssinatura, prazoImplantacao, seloTarefa, textoDoQueVaiAcontecer } from "./fechamento";
import { AceiteSchema, AcaoTarefaSchema } from "./fechamentoSchemas";
import { detalhesDoErro } from "./validacao";

const HOJE = "2026-11-21";

describe("prazos e selos", () => {
  it("assinatura: hoje + 5 corridos, ou a data prevista se for depois; implantação: + 15 corridos", () => {
    expect(PRAZO_ASSINATURA_DIAS).toBe(5);
    expect(PRAZO_IMPLANTACAO_DIAS).toBe(15);
    expect(prazoAssinatura(HOJE, null)).toBe("2026-11-26");
    expect(prazoAssinatura(HOJE, "2026-11-23")).toBe("2026-11-26");
    expect(prazoAssinatura(HOJE, "2026-12-10")).toBe("2026-12-10");
    expect(prazoImplantacao("2026-12-20")).toBe("2027-01-04");
  });

  it("selos: atrasada (prazo antes de hoje), vence hoje; tarefa fechada nunca tem selo", () => {
    expect(seloTarefa({ status: "aberta", prazo: "2026-11-20" }, HOJE)).toBe("atrasada");
    expect(seloTarefa({ status: "em_andamento", prazo: HOJE }, HOJE)).toBe("vence_hoje");
    expect(seloTarefa({ status: "aberta", prazo: "2026-11-22" }, HOJE)).toBeNull();
    expect(seloTarefa({ status: "concluida", prazo: "2026-01-01" }, HOJE)).toBeNull();
    expect(seloTarefa({ status: "cancelada", prazo: "2026-01-01" }, HOJE)).toBeNull();
  });

  it("papel de cada tipo; nome do cliente; o que vai acontecer", () => {
    expect(PAPEL_DO_TIPO).toEqual({ contrato_assinatura: "contratos", implantacao: "implantacao" });
    expect(nomeDoCliente("Maringá")).toBe("Prefeitura Municipal de Maringá");
    const texto = textoDoQueVaiAcontecer({ municipio: "Maringá", uf: "PR", plano: "grande_porte" });
    expect(texto[0]).toBe("Será criado o cliente Prefeitura Municipal de Maringá — PR, AGUARDANDO ASSINATURA (sem cobrança até a assinatura).");
    expect(texto.join(" ")).toMatch(/Grande Porte.*pessoa de Contratos.*data da assinatura/);
  });
});

describe("schema do aceite", () => {
  const valido = {
    versao: 3, plano: "pequeno_porte", valor_mensal: "8500,00", taxa_implantacao: "15000", cnpj: "11.222.333/0001-81",
    endereco_logradouro: "Rua A", endereco_numero: "10", endereco_bairro: "Centro", endereco_cep: "86010-000",
    representante_nome: "Fulano de Tal", representante_cargo: "Prefeito", contato_nome: "Ana", contato_cargo: "Secretária",
    contato_email: "ana@prefeitura.invalid", contato_telefone: "(43) 3333-0000"
  };

  it("válido: CNPJ e CEP viram só dígitos, dinheiro vira centavos, complemento vazio vira null", () => {
    expect(AceiteSchema.parse({ ...valido, endereco_complemento: "" })).toMatchObject({ cnpj: "11222333000181", endereco_cep: "86010000", valor_mensal: 850000, taxa_implantacao: 1500000, endereco_complemento: null });
  });

  it("inválido: CNPJ com dígito errado, CEP curto, Dispensa com taxa, e-mail, faltando — e chave desconhecida", () => {
    const r = AceiteSchema.safeParse({ ...valido, cnpj: "11.222.333/0001-82", endereco_cep: "860", plano: "dispensa", contato_email: "x", representante_nome: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const f = detalhesDoErro(r.error).fieldErrors;
      expect(Object.keys(f).sort()).toEqual(["cnpj", "contato_email", "endereco_cep", "representante_nome", "taxa_implantacao"]);
      expect(f.cnpj).toEqual(["CNPJ inválido — confira os 14 dígitos."]);
    }
    const dispensa = AceiteSchema.safeParse({ ...valido, plano: "dispensa" });
    expect(dispensa.success).toBe(false);
    if (!dispensa.success) expect(detalhesDoErro(dispensa.error).fieldErrors.taxa_implantacao).toHaveLength(1);
    expect(AceiteSchema.safeParse({ ...valido, cpf: "000" }).success).toBe(false);
    expect(AceiteSchema.safeParse({ ...valido, plano: "dispensa", taxa_implantacao: null }).success).toBe(true);
  });

  it("ações de tarefa: estritas; cancelar exige motivo", () => {
    expect(AcaoTarefaSchema.parse({ acao: "concluir", observacao: "" })).toEqual({ acao: "concluir", observacao: null });
    expect(AcaoTarefaSchema.safeParse({ acao: "cancelar" }).success).toBe(false);
    expect(AcaoTarefaSchema.safeParse({ acao: "assumir", extra: 1 }).success).toBe(false);
    expect(AcaoTarefaSchema.safeParse({ acao: "prazo", prazo: "2026-02-30" }).success).toBe(false);
  });
});
