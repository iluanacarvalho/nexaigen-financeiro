// Troca de senha — obrigatória no primeiro acesso (senha_temporaria=true).
// Exige sessão válida e a senha ATUAL (não é fluxo de "esqueci minha
// senha"). lib/auth.ts#trocarSenha já revoga toda sessão (token_version +
// sessao) — esta rota só garante que os cookies DESTA resposta também
// saem limpos, forçando novo login mesmo no dispositivo que fez a troca.
//
// LIMITE (rodada 07, lib/rateLimit.ts): 10 tentativas por conta em 15 min
// → 429. Sem isto, quem estivesse com uma sessão aberta (computador
// destravado) poderia testar senhas atuais à vontade por esta rota.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  NOME_COOKIE_ACCESS,
  NOME_COOKIE_REFRESH,
  obterContextoAutenticado,
  opcoesCookieAccessToken,
  opcoesCookieRefreshToken,
  trocarSenha
} from "@/lib/auth";
import { LIMITE_TROCAR_SENHA, registrarTentativa, respostaLimiteExcedido } from "@/lib/rateLimit";
import { detalhesDoErro } from "@/lib/validacao";

// Mínimo razoável, não uma política formal de complexidade — mesmo padrão
// já usado no projeto irmão nexaigen-educa.
const TrocarSenhaSchema = z.object({
  senha_atual: z.string().min(1, { error: "Informe a senha atual." }),
  nova_senha: z
    .string()
    .min(8, { error: "A nova senha precisa de pelo menos 8 caracteres." })
    .regex(/[A-Za-z]/, { error: "A nova senha precisa de pelo menos uma letra." })
    .regex(/[0-9]/, { error: "A nova senha precisa de pelo menos um número." })
});

export async function POST(req: NextRequest) {
  const contexto = await obterContextoAutenticado(req.cookies.get(NOME_COOKIE_ACCESS)?.value);
  if (!contexto) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const limite = await registrarTentativa(LIMITE_TROCAR_SENHA, contexto.equipeId);
  if (!limite.permitido) return respostaLimiteExcedido(limite.retryAfterSegundos);

  const parsed = TrocarSenhaSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: detalhesDoErro(parsed.error) }, { status: 400 });
  }

  const resultado = await trocarSenha(contexto.equipeId, parsed.data.senha_atual, parsed.data.nova_senha);
  if (!resultado.sucesso) {
    return NextResponse.json({ erro: resultado.erro }, { status: 400 });
  }

  const resposta = NextResponse.json({ ok: true, mensagem: "Senha alterada. Faça login novamente." });
  resposta.cookies.set(NOME_COOKIE_ACCESS, "", { ...opcoesCookieAccessToken(), maxAge: 0 });
  resposta.cookies.set(NOME_COOKIE_REFRESH, "", { ...opcoesCookieRefreshToken(), maxAge: 0 });
  return resposta;
}
