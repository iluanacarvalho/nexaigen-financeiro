// Origens que podem usar o mapa público de fora (rodada 15-B):
// MAPA_PUBLICO_ORIGENS="https://www.nexaigen.com.br,https://nexaigen.com.br"
//   - CORS do GET /api/publico/mapa-clientes (só essas origens leem o JSON
//     pelo navegador a partir de outro domínio);
//   - frame-ancestors da página /mapa (só essas origens podem incorporá-la
//     por iframe — o resto do app continua bloqueado contra iframe).
// Vazia/ausente = só a mesma origem. Entrada inválida (sem http/https, com
// caminho, "*") é DESCARTADA — nunca vira curinga. Sem dependência nenhuma
// (é importado pelo proxy.ts). Funções puras.

/** Lê e valida a lista. Cada item vira a origem canônica ("https://www.exemplo.com.br", sem barra final). */
export function lerOrigensMapaPublico(valor: string | undefined): string[] {
  if (!valor) return [];
  const origens = new Set<string>();
  for (const bruto of valor.split(",")) {
    const item = bruto.trim();
    if (!item) continue;
    try {
      const url = new URL(item);
      const semCaminho = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
      if ((url.protocol === "https:" || url.protocol === "http:") && semCaminho && item.replace(/\/$/, "") === url.origin) origens.add(url.origin);
    } catch {
      // inválida: descartada
    }
  }
  return [...origens];
}

/** Cabeçalhos CORS da API pública: só ecoa a origem se ela estiver na lista (nunca "*"). Sempre `Vary: Origin`. */
export function cabecalhosCors(origemDaRequisicao: string | null, origens: string[]): Record<string, string> {
  const cabecalhos: Record<string, string> = { vary: "Origin" };
  if (origemDaRequisicao && origens.includes(origemDaRequisicao)) {
    cabecalhos["access-control-allow-origin"] = origemDaRequisicao;
    cabecalhos["access-control-allow-methods"] = "GET";
  }
  return cabecalhos;
}

/**
 * Content-Security-Policy da página /mapa: nada de outro domínio (scripts,
 * estilos, imagens, fontes e conexões só da própria origem), e
 * frame-ancestors só a própria origem + MAPA_PUBLICO_ORIGENS. 'unsafe-inline'
 * em script/style porque o Next injeta scripts e estilos inline sem nonce;
 * 'unsafe-eval' só em desenvolvimento (recarga do next dev).
 */
export function cspDoMapa(origens: string[], desenvolvimento: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${desenvolvimento ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    `frame-ancestors ${["'self'", ...origens].join(" ")}`
  ].join("; ");
}
