// Perfis de acesso da equipe NEXAIGEN (rodada 15-A) — FONTE ÚNICA da
// matriz papel × área. Funções puras, testadas em lib/papeis.test.ts.
//
// O Financeiro vai virar o sistema interno da NEXAIGEN (CRM, comissões,
// RH): cada papel enxerga só a sua parte. NEGAÇÃO POR PADRÃO: uma área
// que não está na lista de um papel é negada; uma área NOVA (ou um texto
// qualquer) sem regra só é liberada pro admin. Toda rota de API e toda
// página protegida declara a sua área (lib/auth.ts#exigirPapel,
// lib/authPagina.ts#exigirAreaPagina) — app/api/protecao-rotas.test.ts
// confere a matriz completa rota × papel.
//
// O papel é lido do BANCO a cada requisição (lib/auth.ts#obterContextoAutenticado),
// nunca do JWT: mudar o papel de alguém vale na hora (e, além disso,
// a troca invalida as sessões da pessoa — token_version).

export const PAPEIS = ["admin", "financeiro", "vendas", "rh"] as const;
export type Papel = (typeof PAPEIS)[number];

export const ROTULO_PAPEL: Record<Papel, string> = {
  admin: "Administrador",
  financeiro: "Financeiro",
  vendas: "Vendas",
  rh: "RH"
};

/** Áreas do sistema. `inicio` = página inicial (todo papel tem; vendas/rh veem só a de boas-vindas). */
export const AREAS = ["inicio", "dashboard", "painel", "contratos", "notas", "checagem", "clientes", "alertas", "equipe", "configuracao"] as const;
export type Area = (typeof AREAS)[number];

/**
 * Matriz (admin = tudo, por definição — não precisa listar).
 *   - financeiro: clientes, notas, painel financeiro, relatório de
 *     contratos, checagem — e também o Dashboard (é a página inicial
 *     financeira) e os Alertas de cobrança (é o trabalho de cobrança);
 *   - vendas / rh: reservados pro CRM e pro RH — hoje NENHUMA tela
 *     financeira, só a página inicial de boas-vindas.
 * Equipe (cadastro e papéis) e o status de configuração do servidor: só admin.
 */
const ACESSO: Record<Exclude<Papel, "admin">, readonly Area[]> = {
  financeiro: ["inicio", "dashboard", "painel", "contratos", "notas", "checagem", "clientes", "alertas"],
  vendas: ["inicio"],
  rh: ["inicio"]
};

export function ehPapel(valor: unknown): valor is Papel {
  return typeof valor === "string" && (PAPEIS as readonly string[]).includes(valor);
}

/** O papel pode acessar a área? Papel ou área desconhecidos → só admin (negação por padrão). */
export function podeAcessar(papel: string, area: string): boolean {
  if (!ehPapel(papel)) return false;
  if (papel === "admin") return true;
  return (ACESSO[papel] as readonly string[]).includes(area);
}

export function rotuloDoPapel(papel: string): string {
  return ehPapel(papel) ? ROTULO_PAPEL[papel] : papel;
}

// --- Navegação --------------------------------------------------------------

export interface ItemNav {
  href: string;
  rotulo: string;
  area: Area;
}

/** Itens da NavBar, na ordem. A NavBar mostra só os que o papel pode acessar. */
export const ITENS_NAV: readonly ItemNav[] = [
  { href: "/", rotulo: "Dashboard", area: "dashboard" },
  { href: "/painel", rotulo: "Painel", area: "painel" },
  { href: "/contratos", rotulo: "Novos contratos", area: "contratos" },
  { href: "/notas", rotulo: "Notas fiscais", area: "notas" },
  { href: "/checagem", rotulo: "Fila de Checagem", area: "checagem" },
  { href: "/clientes", rotulo: "Clientes", area: "clientes" },
  { href: "/alertas", rotulo: "Alertas de Cobrança", area: "alertas" },
  { href: "/equipe", rotulo: "Equipe", area: "equipe" }
];

/** Itens visíveis pro papel. Sem nenhum (vendas/rh), a NavBar mostra só "Início". */
export function itensNavDoPapel(papel: string): ItemNav[] {
  const itens = ITENS_NAV.filter((i) => podeAcessar(papel, i.area));
  return itens.length > 0 ? itens : [{ href: "/", rotulo: "Início", area: "inicio" }];
}
