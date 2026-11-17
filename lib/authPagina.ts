// Controle de acesso das PÁGINAS (Server Components) — rodada 15-A. Mesma
// regra das rotas de API (lib/auth.ts#exigirPapel, matriz em
// lib/papeis.ts), só que em vez de 401/403 a página REDIRECIONA:
//   sem sessão → /login · senha temporária pendente → /trocar-senha ·
//   papel sem acesso à área → / (a página inicial existe pra todo papel:
//   vendas/rh veem lá a mensagem de boas-vindas).
// Cada pasta de app/(protegido) tem um layout.tsx que chama
// exigirAreaPagina com a sua área — isto vale mesmo pras páginas "use
// client" (o layout roda no servidor antes delas). As rotas de API por trás
// de cada tela checam o papel de novo, de forma independente (defesa em
// profundidade: um redirect de página nunca é a única barreira).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NOME_COOKIE_ACCESS, obterContextoAutenticado, type ContextoAutenticado } from "./auth";
import { podeAcessar, type Area } from "./papeis";

/** Contexto da sessão a partir do cookie da requisição (null sem sessão válida). */
export async function contextoDaPagina(): Promise<ContextoAutenticado | null> {
  const cookieStore = await cookies();
  return obterContextoAutenticado(cookieStore.get(NOME_COOKIE_ACCESS)?.value);
}

/** Libera a página só pra quem tem acesso à `area`; senão redireciona (ver topo do arquivo). */
export async function exigirAreaPagina(area: Area): Promise<ContextoAutenticado> {
  const contexto = await contextoDaPagina();
  if (!contexto) redirect("/login");
  if (contexto.precisaTrocarSenha) redirect("/trocar-senha");
  if (!podeAcessar(contexto.papel, area)) redirect("/");
  return contexto;
}
