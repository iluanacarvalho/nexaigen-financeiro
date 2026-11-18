/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Raiz do projeto fixada explicitamente (caminho absoluto, como pede a
  // doc do turbopack.root no Next 16). Sem isto, o Next procura o
  // lockfile subindo diretórios e, encontrando um package-lock.json solto
  // na pasta do usuário, avisava no build que estava ignorando a raiz
  // inferida (e poderia resolver arquivos a partir dela).
  turbopack: {
    root: __dirname
  },
  // Otimização de imagens DESLIGADA (rodada 09-A) — redução de superfície:
  // este projeto não usa next/image nem next/og (conferido: nenhum import),
  // mas o servidor do Next mantém o endpoint /_next/image ativo por padrão,
  // e é ele o ponto de entrada de avisos recentes (RCE com SVG —
  // GHSA-2464-fhr4-w9xw; SSRF — GHSA-cjq9-62q9-8jv4). Com `unoptimized`,
  // o servidor responde 404 nesse endpoint ANTES de validar parâmetros ou
  // buscar qualquer imagem (next/dist/server/next-server.js). Se um dia
  // alguma tela precisar de next/image, revisitar isto conscientemente.
  images: {
    unoptimized: true
  },
  // Anti-iframe (rodada 15-B): o app inteiro recusa ser incorporado por
  // iframe (clickjacking) — EXCETO a página pública /mapa, que o site
  // institucional incorpora. Os cabeçalhos dela (frame-ancestors com as
  // origens de MAPA_PUBLICO_ORIGENS, lidas em tempo de execução) vêm do
  // proxy.ts. Testado em next.config.test.ts.
  async headers() {
    return [
      {
        source: "/:caminho((?!mapa$).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }
        ]
      }
    ];
  }
};

module.exports = nextConfig;
