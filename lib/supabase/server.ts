import { createClient } from "@supabase/supabase-js";

// supabaseServer() (chave anon, RLS-gated via createServerClient +
// cookies do Supabase Auth) foi removida nesta rodada de correção de
// achado crítico de segurança — nunca fez sentido pra este projeto de
// verdade: este login (lib/auth.ts) é 100% independente do Supabase
// Auth, nunca chama `supabase.auth.signIn*`, então nenhuma chamada daqui
// jamais teria um `auth.uid()` de verdade — a RLS (que agora nega tudo
// por padrão, ver supabase/schema.sql) bloquearia SEMPRE. Toda rota
// (inclusive o job de cron, que já usava isto antes) usa esta função
// abaixo — service_role, ignora RLS por definição — com o controle de
// acesso real feito por lib/auth.ts#exigirSessao, não mais pela RLS.
export function supabaseAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
