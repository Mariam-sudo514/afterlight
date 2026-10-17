import { createSupabaseServerClient } from "@/lib/supabase/server";
import { apiError, authForm, authRedirect, verifyOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    verifyOrigin(request);
    const form = await authForm(request);
    const lang = form.get("lang") === "en" ? "en" : "ru";
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) return authRedirect(`/login?lang=${lang}&error=unavailable`);
    return authRedirect(`/${lang}`);
  } catch (error) {
    return apiError(error);
  }
}
