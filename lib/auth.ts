import "server-only";
import { AppError } from "./http";
import { createSupabaseServerClient } from "./supabase/server";

export type EditorIdentity = {
  userId: string;
  email: string;
  displayName: string;
};

export async function editorIdentity(): Promise<EditorIdentity | null> {
  const supabase = await createSupabaseServerClient();
  // getUser contacts Auth to validate the supplied session; cookie contents alone are untrusted.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.email || !user.email_confirmed_at) return null;
  const { data: owner, error: ownerError } = await supabase.rpc("is_owner");
  if (ownerError) throw new AppError("unavailable", 503);
  if (owner !== true) return null;
  const name: unknown = user.user_metadata?.display_name;
  const displayName =
    typeof name === "string" && name.trim() && name.length <= 80
      ? name.trim()
      : user.email;
  return { userId: user.id, email: user.email, displayName };
}

export async function requireEditor(): Promise<EditorIdentity> {
  const editor = await editorIdentity();
  if (!editor) throw new AppError("forbidden", 403);
  return editor;
}
