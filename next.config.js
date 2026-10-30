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
  }
};

module.exports = nextConfig;
