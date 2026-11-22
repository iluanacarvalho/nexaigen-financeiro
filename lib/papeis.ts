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

export const PAPEIS = ["admin", "financeiro", "vendas", "rh", "contratos", "implantacao"] as const;
export type Papel = (typeof PAPEIS)[number];

export const ROTULO_PAPEL: Record<Papel, string> = {
  admin: "Administrador",
  financeiro: "Financeiro",
  vendas: "Vendas",
  rh: "RH",
  contratos: "Contratos",
  implantacao: "Implantação"
};

/**
 * Áreas do sistema. `inicio` = página inicial (todo papel tem; vendas/rh veem
 * a de boas-vindas). `crm` = funil de leads (rodada 16-A); `crm_gestao` = o
 * que no CRM é só de admin (exportar a carteira, reatribuir vendedor) — área
 * própria pra também cair na negação por padrão, sem `if` solto nas rotas.
 *
 * Rodada 16-B1 (fechamento): `operacao` = fila de tarefas (Contratos e
 * Implantação) e os dados MÍNIMOS do cliente que cada um precisa (rotas e
 * consultas próprias — nunca as rotas completas de /api/clientes);
 * `contrato_gerado` = baixar o contrato gerado a partir do modelo (vendas
 * só do SEU fechamento — conferido na rota); `modelos_contrato` = editar e
 * aprovar os modelos (só admin).
 */
export const AREAS = [
  "inicio", "dashboard", "painel", "contratos", "notas", "checagem", "clientes", "alertas", "equipe", "configuracao", "crm", "crm_gestao",
  "operacao", "contrato_gerado", "modelos_contrato"
] as const;
export type Area = (typeof AREAS)[number];

/**
 * Matriz (admin = tudo, por definição — não precisa listar).
 *   - financeiro: clientes, notas, painel financeiro, relatório de
 *     contratos, checagem — e também o Dashboard (é a página inicial
 *     financeira) e os Alertas de cobrança (é o trabalho de cobrança);
 *   - vendas: o CRM (rodada 16-A) — e, dentro dele, SÓ os leads em que é o
 *     vendedor (filtro no SQL, lib/crmRepositorio.ts); nenhuma tela financeira;
 *   - rh: reservado pro módulo de RH — hoje só a página inicial.
 *   - contratos (16-B1): a fila de tarefas e o contrato gerado — nada
 *     financeiro (painel, notas, alertas, checagem), nada de CRM;
 *   - implantacao (16-B1): só a fila de tarefas (com os dados mínimos do
 *     cliente pra implantar) — nada financeiro, nada de CRM.
 * Financeiro e rh NÃO veem o CRM nem as áreas do fechamento. Equipe
 * (cadastro e papéis), status de configuração do servidor, a gestão do CRM
 * (crm_gestao) e os modelos de contrato: só admin.
 *
 * ATENÇÃO: a área "contratos" é o RELATÓRIO de novos contratos (15-A, do
 * financeiro) — não confundir com o PAPEL "contratos" (16-B1), que NÃO a tem.
 */
const ACESSO: Record<Exclude<Papel, "admin">, readonly Area[]> = {
  financeiro: ["inicio", "dashboard", "painel", "contratos", "notas", "checagem", "clientes", "alertas"],
  vendas: ["inicio", "crm", "contrato_gerado"],
  rh: ["inicio"],
  contratos: ["inicio", "operacao", "contrato_gerado"],
  implantacao: ["inicio", "operacao"]
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
  { href: "/crm", rotulo: "CRM", area: "crm" },
  { href: "/operacao", rotulo: "Tarefas", area: "operacao" },
  { href: "/modelos-contrato", rotulo: "Modelos de contrato", area: "modelos_contrato" },
  { href: "/equipe", rotulo: "Equipe", area: "equipe" }
];

const INICIO: ItemNav = { href: "/", rotulo: "Início", area: "inicio" };

/**
 * Itens visíveis pro papel. Quem não tem o Dashboard (vendas, rh) ganha
 * "Início" na frente — a página inicial deles é a de boas-vindas.
 */
export function itensNavDoPapel(papel: string): ItemNav[] {
  const itens = ITENS_NAV.filter((i) => podeAcessar(papel, i.area));
  return podeAcessar(papel, "dashboard") ? itens : [INICIO, ...itens];
}
