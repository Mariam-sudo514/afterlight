import "server-only";
import { getAllowedOrigins } from "./config";

export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function apiError(error: unknown): Response {
  if (error instanceof AppError)
    return json({ error: error.code }, error.status);
  // Do not log upstream errors: they can contain URLs, credentials or article text.
  console.error("afterlight_request_failed");
  return json({ error: "unavailable" }, 503);
}

export function verifyOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || !getAllowedOrigins().includes(origin))
    throw new AppError("forbidden", 403);
}

export function verifyMutation(request: Request): void {
  verifyOrigin(request);
  if (request.headers.get("x-afterlight-editor") !== "1")
    throw new AppError("forbidden", 403);
}

export async function limitedBytes(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    throw new AppError("too_large", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("invalid_content");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new AppError("too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function authForm(request: Request): Promise<URLSearchParams> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/x-www-form-urlencoded"
  ) {
    throw new AppError("invalid_content");
  }
  const form = new URLSearchParams(
    new TextDecoder().decode(await limitedBytes(request, 8192)),
  );
  for (const field of ["email", "password", "lang"]) {
    if (form.getAll(field).length > 1) throw new AppError("invalid_content");
  }
  return form;
}

/** A fixed internal path avoids trusting Host, forwarded headers or return URLs. */
export function authRedirect(path: string): Response {
  if (!/^\/(?:admin|login|ru|en)(?:\?|$)/.test(path) || /[\r\n\\]/.test(path)) {
    throw new AppError("invalid_content");
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: path,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
