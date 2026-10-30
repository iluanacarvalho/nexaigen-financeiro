// Fila de Checagem — confirmação ao enviar nova versão do PDF ("a versão
// anterior será mantida"), histórico com links reais por versão, e o
// registro de atesto passando pela rota /verificar. Fetch falso.

import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { instalarFetchFalso } from "@/testes/fetchFalso";
import FilaChecagemPage from "./page";

const NOTA = {
  id: "n1",
  cliente_id: "c1",
  numero_nf: "321",
  valor: "800.00",
  competencia: "2026-10-01",
  data_emissao: "2026-10-02",
  data_atesto: null,
  data_limite_pagamento: null,
  data_pagamento: null,
  status: "aguardando_atesto",
  situacao: "aguardando_atesto",
  motivo_cancelamento: null,
  cancelado_em: null,
  arquivo_pdf_nome: "NF 321.pdf",
  arquivo_pdf_versao_atual: 2,
  cliente: { id: "c1", nome: "Prefeitura de Gama", uf: "MG", sistema_portal: "e-Cidade", portal_url: "https://portal.exemplo.invalid" }
};

const VERSOES = [
  { versao: 2, nome: "NF 321 corrigida.pdf", tamanho_bytes: 2048, sha256: "a".repeat(64), enviado_em: "2026-10-03T13:00:00.000Z", enviado_por_nome: "Ana", motivo: "valor corrigido", atual: true },
  { versao: 1, nome: "NF 321.pdf", tamanho_bytes: null, sha256: null, enviado_em: "2026-10-02T13:00:00.000Z", enviado_por_nome: null, motivo: null, atual: false }
];

describe("Fila de Checagem", () => {
  it("lista só as notas aguardando atesto (mesma listagem paginada da tela de Notas)", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/notas": { corpo: { notas: [NOTA], total: 1 } } });
    render(<FilaChecagemPage />);
    expect(await screen.findByText("Prefeitura de Gama — MG")).toBeTruthy();
    expect(chamadas[0].url).toMatch(/^\/api\/notas\?situacao=aguardando_atesto&/);
  });

  it("nova versão do PDF: pede confirmação dizendo que a anterior é mantida; só envia ao confirmar, com o motivo", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/notas": { corpo: { notas: [NOTA], total: 1 } },
      "POST /api/notas/n1/arquivo": { corpo: { ok: true, versao: 3 } }
    });
    const usuario = userEvent.setup();
    render(<FilaChecagemPage />);
    await screen.findByText("Versão atual: v2");

    await usuario.upload(screen.getByLabelText("Arquivo PDF do nota fiscal"), new File(["%PDF-1.4"], "NF 321 v3.pdf", { type: "application/pdf" }));
    const dialogo = screen.getByRole("dialog", { name: "Confirmar nova versão do nota fiscal" });
    expect(dialogo.textContent).toMatch(/A versão anterior será mantida no histórico/);
    expect(dialogo.textContent).toMatch(/\(v2\) por NF 321 v3\.pdf/);
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);

    await usuario.type(within(dialogo).getByRole("textbox"), "reemitida");
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar e enviar nova versão" }));

    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST")).toBe(true));
    const envio = chamadas.find((c) => c.metodo === "POST")!.corpo as FormData;
    expect((envio.get("arquivo") as File).name).toBe("NF 321 v3.pdf");
    expect(envio.get("motivo")).toBe("reemitida");
  });

  it("desistir da substituição não envia nada", async () => {
    const chamadas = instalarFetchFalso({ "GET /api/notas": { corpo: { notas: [NOTA], total: 1 } } });
    const usuario = userEvent.setup();
    render(<FilaChecagemPage />);
    await screen.findByText("Versão atual: v2");
    await usuario.upload(screen.getByLabelText("Arquivo PDF do nota fiscal"), new File(["%PDF-1.4"], "x.pdf", { type: "application/pdf" }));
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);
  });

  it("histórico: carrega ao abrir, com link REAL de download por versão (<a download>, nunca botão)", async () => {
    instalarFetchFalso({
      "GET /api/notas/n1/arquivo/versoes": { corpo: { versoes: VERSOES } },
      "GET /api/notas": { corpo: { notas: [NOTA], total: 1 } }
    });
    const usuario = userEvent.setup();
    render(<FilaChecagemPage />);
    await usuario.click(await screen.findByText("Histórico de versões"));

    const v1 = await screen.findByRole("link", { name: "NF 321.pdf" });
    expect(v1.getAttribute("href")).toBe("/api/notas/n1/arquivo?versao=1");
    expect(v1.hasAttribute("download")).toBe(true);
    expect(screen.getByRole("link", { name: "NF 321 corrigida.pdf" }).getAttribute("href")).toBe("/api/notas/n1/arquivo?versao=2");
    expect(screen.getByText("atual")).toBeTruthy();
    expect(screen.getByText("Motivo: valor corrigido")).toBeTruthy();
    expect(screen.getByText(/autor não registrado/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Baixar nota fiscal/ }).getAttribute("href")).toBe("/api/notas/n1/arquivo");
  });

  it("'Atestada hoje' passa pela rota de verificação; 409 do servidor aparece na linha", async () => {
    const chamadas = instalarFetchFalso({
      "GET /api/notas": { corpo: { notas: [NOTA], total: 1 } },
      "POST /api/notas/n1/verificar": { status: 409, corpo: { erro: "O atesto desta nota já foi registrado." } }
    });
    const usuario = userEvent.setup();
    render(<FilaChecagemPage />);
    await usuario.click(await screen.findByRole("button", { name: "Atestada hoje" }));
    expect(await screen.findByText("O atesto desta nota já foi registrado.")).toBeTruthy();
    expect(chamadas.find((c) => c.metodo === "POST")?.corpo).toEqual({ resultado: "atestada" });
  });
});
