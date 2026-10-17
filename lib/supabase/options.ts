import "server-only";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/config";

export function sessionCookieOptions() {
  const supabase = new URL(getSupabaseConfig().url);
  const project = `${supabase.hostname}-${supabase.port || "default"}`.replace(
    /[^a-z0-9-]/gi,
    "-",
  );
  return {
    // Browser cookies ignore ports. Keep isolated local Supabase projects separate.
    name: `afterlight-${project}-auth`,
    path: "/",
    sameSite: "lax" as const,
    secure: getSiteOrigin().startsWith("https://"),
    // Auth is handled exclusively by server routes; no browser Supabase client.
    httpOnly: true,
  };
}

export const uncachedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });
