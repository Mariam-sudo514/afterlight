import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  AppError,
  apiError,
  authForm,
  authRedirect,
  verifyOrigin,
} from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let lang =
    new URL(request.url).searchParams.get("lang") === "en" ? "en" : "ru";
  const failed = (error: string) =>
    authRedirect(`/login?lang=${lang}&error=${error}`);
  try {
    verifyOrigin(request);
    const form = await authForm(request);
    lang = form.get("lang") === "en" ? "en" : "ru";
    const email = (form.get("email") ?? "").trim().toLowerCase();
    const password = form.get("password") ?? "";
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !password ||
      password.length > 1024
    ) {
      return failed("credentials");
    }

    // Shared database limits survive restarts and cannot be bypassed by spoofing an IP header.
    const admin = createSupabaseAdminClient();
    const accountKey = createHash("sha256").update(email).digest("hex");
    const limits = await Promise.all([
      admin.rpc("consume_rate_limit", {
        p_key: `login:${accountKey}`,
        p_limit: 10,
        p_window_seconds: 900,
      }),
      admin.rpc("consume_rate_limit", {
        p_key: "login:global",
        p_limit: 100,
        p_window_seconds: 900,
      }),
    ]);
    if (limits.some(({ error }) => error)) return failed("unavailable");
    if (limits.some(({ data }) => data !== true)) {
      const response = failed("rate_limit");
      response.headers.set("Retry-After", "900");
      return response;
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      if (error.status === 429) return failed("rate_limit");
      if (
        error.code === "email_provider_disabled" ||
        (error.status ?? 0) >= 500
      ) {
        return failed("unavailable");
      }
      return failed("credentials");
    }
    if (!data.user?.email_confirmed_at) return failed("credentials");
    const { data: owner, error: ownerError } = await supabase.rpc("is_owner");
    if (ownerError || owner !== true) {
      await supabase.auth.signOut({ scope: "local" });
      return failed(ownerError ? "unavailable" : "access");
    }
    return authRedirect(`/admin?lang=${lang}`);
  } catch (error) {
    if (error instanceof AppError) return apiError(error);
    return failed("unavailable");
  }
}
