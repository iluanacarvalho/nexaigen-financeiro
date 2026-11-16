// Dashboard — aviso de configuração faltando (rodada 07), em linguagem
// simples e sem nenhum valor de variável, e os números vindos da MESMA
// fonte do Painel (lib/resumoDashboard.ts — rodada 08). Server Component:
// o teste chama a página e renderiza o JSX; a leitura do banco é mockada.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { obterResumoMock } = vi.hoisted(() => ({ obterResumoMock: vi.fn() }));
vi.mock("@/lib/resumoDashboard", () => ({ obterResumoDashboard: obterResumoMock }));

import Dashboard from "./page";

const SENTINELA = "SENTINELA-nao-pode-aparecer-3e9";
const VARIAVEIS = ["RESEND_API_KEY", "ALERTA_EMAIL_REMETENTE", "ALERTA_SISTEMA_EMAILS_DESTINO", "COBRANCA_EMAIL_DESTINO", "RAILWAY_BUCKET_NAME", "RAILWAY_BUCKET_ACCESS_KEY_ID", "RAILWAY_BUCKET_SECRET_ACCESS_KEY", "RAILWAY_BUCKET_ENDPOINT", "CRON_SECRET", "INTEGRACAO_SECRET", "JWT_SECRET"];
const originais: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const v of VARIAVEIS) {
    originais[v] = process.env[v];
    process.env[v] = `${SENTINELA}-${v}`;
  }
  obterResumoMock.mockResolvedValue({ semNotas: false, contagemPorSituacao: { aguardando_atesto: 2, atestada: 1, vencida: 3, atraso_critico: 1 }, emAbertoCentavos: 1234567, alertasCriticosAtivos: 1, implantacaoACobrar: { clientes: 0, centavos: 0 } });
});

afterEach(() => {
  for (const v of VARIAVEIS) {
    if (originais[v] === undefined) delete process.env[v];
    else process.env[v] = originais[v];
  }
});

describe("Dashboard", () => {
  it("tudo configurado: nenhum aviso; números do resumo compartilhado com o Painel", async () => {
    render(await Dashboard());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Vencidas").nextElementSibling!.textContent).toBe("3");
    expect(screen.getByText("Valor total em aberto").nextElementSibling!.textContent).toMatch(/R\$\s*12\.345,67/);
    expect(document.body.textContent).not.toContain(SENTINELA);
  });

  it("faltando Resend e bucket: aviso em linguagem simples, um por funcionalidade, sem valor nenhum", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RAILWAY_BUCKET_ENDPOINT;
    render(await Dashboard());

    const aviso = screen.getByRole("alert");
    expect(aviso.textContent).toMatch(/Configuração incompleta/);
    expect(aviso.textContent).toMatch(/E-mails não serão enviados.*RESEND_API_KEY/);
    expect(aviso.textContent).toMatch(/PDFs \(nota fiscal e contrato\) não poderão ser anexados/);
    expect(aviso.querySelectorAll("li")).toHaveLength(2);
    expect(document.body.textContent).not.toContain(SENTINELA);
  });

  it("banco sem notas: '—' nos cards (nunca 0 fingindo dado) e mensagem", async () => {
    obterResumoMock.mockResolvedValue({ semNotas: true, contagemPorSituacao: null, emAbertoCentavos: null, alertasCriticosAtivos: 0, implantacaoACobrar: { clientes: 0, centavos: 0 } });
    render(await Dashboard());
    expect(screen.getByText("Aguardando atesto").nextElementSibling!.textContent).toBe("—");
    expect(screen.getByText("Valor total em aberto").nextElementSibling!.textContent).toBe("—");
    expect(screen.getByText(/Nenhuma nota fiscal ainda/)).toBeTruthy();
  });

  it("implantação a cobrar: cartão com contagem e valor (mesma conta do Painel), só quando há o que cobrar", async () => {
    obterResumoMock.mockResolvedValue({ semNotas: false, contagemPorSituacao: { aguardando_atesto: 0, atestada: 0, vencida: 0, atraso_critico: 0 }, emAbertoCentavos: 0, alertasCriticosAtivos: 0, implantacaoACobrar: { clientes: 2, centavos: 4500000 } });
    render(await Dashboard());
    const cartao = screen.getByText(/Implantação a cobrar: 2 clientes/);
    expect(cartao.textContent).toMatch(/R\$\s*45\.000,00/);
    expect(cartao.closest("a")!.getAttribute("href")).toBe("/notas");
  });
});

