// Troca de senha obrigatória no primeiro acesso — FORA do grupo
// app/(protegido)/, de propósito: aquele layout redireciona QUALQUER
// sessão com precisa_trocar_senha=true pra cá, então se esta própria
// página estivesse dentro do grupo protegido ela entraria num loop de
// redirecionamento infinito antes de conseguir renderizar o formulário
// (mesmo raciocínio de app/admin/trocar-senha/page.tsx no nexaigen-educa).
//
// Ainda assim exige QUE EXISTA sessão (só não que a senha já tenha sido
// trocada) — sem cookie nenhum, manda pra /login.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NOME_COOKIE_ACCESS, obterContextoAutenticado } from "@/lib/auth";
import TrocarSenhaForm from "./TrocarSenhaForm";

export default async function TrocarSenhaPage() {
  const cookieStore = await cookies();
  const contexto = await obterContextoAutenticado(cookieStore.get(NOME_COOKIE_ACCESS)?.value);
  if (!contexto) {
    redirect("/login");
  }

  return <TrocarSenhaForm />;
}
