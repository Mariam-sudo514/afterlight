import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServiceRoleKey, getSupabaseConfig } from "@/lib/config";
import { uncachedFetch } from "./options";

/** Administrative use only; never attach request cookies to this RLS-bypassing client. */
export function createSupabaseAdminClient() {
  return createClient(getSupabaseConfig().url, getServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: uncachedFetch },
  });
}
