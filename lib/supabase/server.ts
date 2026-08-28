import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// UPGRADE Next.js 16 (correção de segurança): cookies() de next/headers ficou
// assíncrono a partir do Next 15 e, no Next 16, o acesso síncrono foi
// removido de vez — por isso esta função é async e todo chamador precisa
// usar `await supabaseServer()`.
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: any) {
        cookieStore.set({ name, value: "", ...options });
      }
    }
  });
}

/** service_role — ignora RLS. Uso restrito ao job de cron (app/api/cron/*). */
export function supabaseAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
