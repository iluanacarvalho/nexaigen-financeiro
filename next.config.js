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
  }
};

module.exports = nextConfig;
