// Rodada de correção de achado crítico de segurança: shell protegido pra
// todas as páginas que mostram dado real (dashboard, clientes, alertas,
// fila de checagem) — mesmo padrão de app/admin/(painel)/layout.tsx do
// projeto irmão nexaigen-educa. Route group `(protegido)` não afeta a
// URL (Next.js) — /clientes continua em /clientes, só o arquivo mora em
// app/(protegido)/clientes/page.tsx.
//
// Server Component: lê o cookie de sessão (lib/authPagina.ts#contextoDaPagina,
// via next/headers#cookies()) e passa pra obterContextoAutenticado() (que recebe o token como
// parâmetro, por testabilidade — ver o comentário completo em
// lib/auth.ts), redirecionando pra /login se não houver sessão válida.
// Isto é a checagem de SEGURANÇA de verdade pras páginas — cada rota de
// API por trás delas também chama exigirSessao() de forma independente
// (defesa em profundidade, mesmo espírito do nexaigen-educa: um 403/401
// na API nunca depende só da página ter feito a checagem certa).
//
// /login e /trocar-senha ficam DELIBERADAMENTE FORA deste grupo — a
// primeira porque não pode exigir sessão (é onde a sessão é criada), a
// segunda porque precisa renderizar mesmo com precisa_trocar_senha=true
// (checado dentro da própria página, não aqui).

import { redirect } from "next/navigation";
import { contextoDaPagina } from "@/lib/authPagina";
import NavBar from "../NavBar";

// Papel (rodada 15-A): este layout só exige SESSÃO — o acesso por área de
// cada página fica no layout.tsx da própria pasta (lib/authPagina.ts#exigirAreaPagina);
// a NavBar recebe o papel e mostra só os itens permitidos.
export default async function ProtegidoLayout({ children }: { children: React.ReactNode }) {
  const contexto = await contextoDaPagina();
  if (!contexto) {
    redirect("/login");
  }
  // Senha temporária pendente — manda pra /trocar-senha antes de liberar
  // o resto do sistema, mesmo padrão de app/admin/(painel)/layout.tsx do
  // nexaigen-educa. Isto é só UX (evita montar o shell antes da hora); o
  // bloqueio de SEGURANÇA de verdade fica em cada rota de API — nenhuma
  // delas confia neste redirect pra impedir uso com senha temporária.
  if (contexto.precisaTrocarSenha) {
    redirect("/trocar-senha");
  }

  return (
    <>
      <NavBar nome={contexto.nome} papel={contexto.papel} />
      {children}
    </>
  );
}
