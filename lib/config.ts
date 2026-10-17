import "server-only";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function keySetting(primary: string, legacy: string): string {
  const preferred = process.env[primary]?.trim();
  const compatible = process.env[legacy]?.trim();
  if (preferred && compatible && preferred !== compatible) {
    throw new Error(`Conflicting server configuration: ${primary} / ${legacy}`);
  }
  if (preferred || compatible) return (preferred || compatible)!;
  throw new Error(`Missing server configuration: ${primary}`);
}

function legacyRole(key: string): unknown {
  try {
    return JSON.parse(
      Buffer.from(key.split(".")[1] ?? "", "base64url").toString(),
    ).role;
  } catch {
    return undefined;
  }
}

function origin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid server configuration: ${name}`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol === "http:" && !local) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Invalid server configuration: ${name}`);
  }
  return url.origin;
}

/** The canonical URL is explicit, never inferred from an untrusted Host header. */
export function getSiteOrigin(): string {
  return origin(required("SITE_ORIGIN"), "SITE_ORIGIN");
}

export function getAllowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGINS?.trim();
  if (!configured) return [getSiteOrigin()];
  return [
    ...new Set(
      configured
        .split(",")
        .map((value) => origin(value.trim(), "ALLOWED_ORIGINS")),
    ),
  ];
}

export function getSupabaseConfig(): { url: string; anonKey: string } {
  const anonKey = keySetting("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  // A service credential must never become the session client's default role.
  const role = legacyRole(anonKey);
  if (!anonKey.startsWith("sb_publishable_") && role !== "anon") {
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY must be an anonymous or publishable key",
    );
  }
  return { url: origin(required("SUPABASE_URL"), "SUPABASE_URL"), anonKey };
}

export function getServiceRoleKey(): string {
  const key = keySetting("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  if (!key.startsWith("sb_secret_") && legacyRole(key) !== "service_role") {
    throw new Error(
      "SUPABASE_SECRET_KEY must be a server secret or service-role key",
    );
  }
  return key;
}
