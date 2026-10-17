import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/config";
import { localeFromUrl } from "@/lib/content";
import { sessionCookieOptions, uncachedFetch } from "@/lib/supabase/options";

export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  // Always derive locale from the URL, never from a client-provided locale header.
  requestHeaders.set("x-afterlight-locale", localeFromUrl(request.nextUrl));
  for (const name of requestHeaders.keys()) {
    if (name.toLowerCase().startsWith("oai-authenticated-"))
      requestHeaders.delete(name);
  }
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const { url, anonKey } = getSupabaseConfig();
  const supabase = createServerClient(url, anonKey, {
    cookieOptions: sessionCookieOptions(),
    global: { fetch: uncachedFetch },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(values, cacheHeaders) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
        response = NextResponse.next({ request: { headers: requestHeaders } });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(cacheHeaders ?? {}).forEach(([name, value]) =>
          response.headers.set(name, value),
        );
      },
    },
  });
  // Proxy refreshes cookies, while each protected page/API independently authorizes.
  await supabase.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export const config = {
  matcher: [
    "/",
    "/ru/:path*",
    "/en/:path*",
    "/admin/:path*",
    "/login",
    "/api/:path*",
    "/media/:path*",
  ],
};
