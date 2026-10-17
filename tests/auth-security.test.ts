import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  getAllowedOrigins,
  getSiteOrigin,
  getSupabaseConfig,
  getServiceRoleKey,
} from "../lib/config";
import {
  AppError,
  authForm,
  authRedirect,
  limitedBytes,
  verifyMutation,
  verifyOrigin,
} from "../lib/http";
import { sessionCookieOptions } from "../lib/supabase/options";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.SITE_ORIGIN = "http://localhost:3000";
  process.env.ALLOWED_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000";
  process.env.SUPABASE_URL = "http://127.0.0.1:56321";
  process.env.SUPABASE_ANON_KEY = "sb_publishable_local_fixture_only";
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  for (const name of [
    "SITE_ORIGIN",
    "ALLOWED_ORIGINS",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

test("modern cloud keys work on the server; mixed local/cloud aliases and reversed keys are rejected", () => {
  delete process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cloud_fixture_only";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_cloud_fixture_only";
  assert.equal(
    getSupabaseConfig().anonKey,
    process.env.SUPABASE_PUBLISHABLE_KEY,
  );
  assert.equal(getServiceRoleKey(), process.env.SUPABASE_SECRET_KEY);
  process.env.SUPABASE_ANON_KEY = "sb_publishable_different_fixture";
  assert.throws(getSupabaseConfig, /Conflicting server configuration/);
  delete process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_different_fixture";
  assert.throws(getServiceRoleKey, /Conflicting server configuration/);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SECRET_KEY = "sb_publishable_readonly_fixture";
  assert.throws(getServiceRoleKey, /must be a server secret/);
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_secret_wrong_place_fixture";
  assert.throws(getSupabaseConfig, /must be an anonymous or publishable key/);
});

const forbidden = (error: unknown) =>
  error instanceof AppError && error.status === 403;
const tooLarge = (error: unknown) =>
  error instanceof AppError && error.status === 413;

test("canonical origin and origin allowlist reject credentials, paths and insecure remote URLs", () => {
  assert.equal(getSiteOrigin(), "http://localhost:3000");
  assert.deepEqual(getAllowedOrigins(), [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
  for (const value of [
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com?x=1",
    "http://example.com",
    "//example.com",
  ]) {
    process.env.SITE_ORIGIN = value;
    assert.throws(getSiteOrigin, /Invalid server configuration/);
  }
  process.env.ALLOWED_ORIGINS = "*";
  assert.throws(getAllowedOrigins, /Invalid server configuration/);
});

test("service-role credentials cannot be used as the ordinary session key", () => {
  process.env.SUPABASE_ANON_KEY = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  assert.throws(getSupabaseConfig, /must be an anonymous or publishable key/);
  process.env.SUPABASE_ANON_KEY = "sb_secret_example";
  assert.throws(getSupabaseConfig, /must be an anonymous or publishable key/);
});

test("session cookies stay HttpOnly and are isolated by Supabase project, including local ports", () => {
  const development = sessionCookieOptions();
  assert.equal(development.httpOnly, true);
  assert.equal(development.sameSite, "lax");
  assert.equal(development.secure, false);
  process.env.SUPABASE_URL = "http://127.0.0.1:57321";
  assert.notEqual(sessionCookieOptions().name, development.name);
  process.env.SITE_ORIGIN = "https://journal.example";
  assert.equal(sessionCookieOptions().secure, true);
});

test("mutations require exact configured Origin and the editor header, ignoring forged platform headers", () => {
  for (const origin of [
    null,
    "null",
    "https://evil.example",
    "http://localhost:3000.evil.example",
    "http://localhost:3001",
    "http://localhost:3000/",
  ]) {
    const headers = new Headers({
      "x-afterlight-editor": "1",
      "oai-authenticated-user-id": "owner",
    });
    if (origin) headers.set("origin", origin);
    assert.throws(
      () =>
        verifyMutation(
          new Request("http://localhost:3000/api/admin/posts", {
            method: "POST",
            headers,
          }),
        ),
      forbidden,
    );
  }
  const request = new Request("http://localhost:3000/api/admin/posts", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "x-afterlight-editor": "1" },
  });
  assert.doesNotThrow(() => verifyMutation(request));
  assert.throws(
    () =>
      verifyMutation(
        new Request(request.url, {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    forbidden,
  );
  assert.doesNotThrow(() =>
    verifyOrigin(
      new Request(request.url, {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    ),
  );
});

test("body limit checks actual bytes, including absent or false Content-Length", async () => {
  for (const headers of [
    new Headers(),
    new Headers({ "content-length": "1" }),
    new Headers({ "content-length": "100" }),
  ]) {
    await assert.rejects(
      limitedBytes(
        new Request("http://localhost/api", {
          method: "POST",
          body: "12345",
          headers,
        }),
        4,
      ),
      tooLarge,
    );
  }
  assert.equal(
    new TextDecoder().decode(
      await limitedBytes(
        new Request("http://localhost/api", { method: "POST", body: "1234" }),
        4,
      ),
    ),
    "1234",
  );
});

test("auth forms reject duplicate credential fields and oversized passwords at transport boundary", async () => {
  const request = (body: string) =>
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  await assert.rejects(
    authForm(request("email=a&email=b&password=x")),
    /invalid_content/,
  );
  await assert.rejects(
    authForm(request(`password=${"x".repeat(8200)}`)),
    tooLarge,
  );
  const form = await authForm(
    request("email=owner%40example.com&password=example&lang=en"),
  );
  assert.equal(form.get("email"), "owner@example.com");
});

test("auth redirects permit only fixed internal routes without trusting supplied hosts", () => {
  const response = authRedirect("/admin?lang=en");
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/admin?lang=en");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  for (const path of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/api/auth/login",
    "/admin/../../evil",
    "/admin\r\nLocation: https://evil.example",
  ]) {
    assert.throws(() => authRedirect(path), /invalid_content/);
  }
});
