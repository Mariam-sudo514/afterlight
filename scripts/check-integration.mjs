import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { request } from "@playwright/test";
import sharp from "sharp";
import {
  root,
  testRoot,
  startServices,
  stopServices,
  serviceEnv,
  requireCli,
  assertPortsAvailable,
} from "./local-lib.mjs";
import { seed } from "./seed.mjs";
import { runBrowserFlow } from "../tests/browser-flow.mjs";

const artifactDir = path.join(root, "outputs/integration");
await fs.mkdir(artifactDir, { recursive: true });
const checks = [];
const record = (message) => {
  checks.push(message);
  console.log(`PASS ${message}`);
};
let app,
  appLog,
  admin,
  ownerId,
  otherId,
  context,
  anonContext,
  otherContext,
  replay;
const ids = [];
let started = false;
await stopServices(true);
const values = await startServices(true);
const env = serviceEnv(values, true);
const baseURL = env.SITE_ORIGIN;
const client = (key) =>
  createClient(values.API_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
admin = client(values.SERVICE_ROLE_KEY);
const ownerEmail = `afterlight-owner-${randomUUID()}@example.test`;
const otherEmail = `afterlight-other-${randomUUID()}@example.test`;
const ownerPassword = randomBytes(24).toString("base64url") + "aA1!";
const otherPassword = randomBytes(24).toString("base64url") + "aA1!";
const headers = { Origin: baseURL, "X-Afterlight-Editor": "1" };
async function createAccount(email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(error, null);
  return data.user.id;
}
async function waitApp() {
  for (let n = 0; n < 120; n++) {
    try {
      const response = await fetch(`${baseURL}/ru`);
      if (response.status === 200) return;
    } catch {}
    if (app.exitCode !== null)
      throw new Error(
        "Test Next server exited. Inspect outputs/integration/server.log.",
      );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Test Next server did not become ready within 120s.");
}
async function login(ctx, email, password) {
  return await ctx.post("/api/auth/login", {
    form: { email, password, lang: "en" },
    headers,
    maxRedirects: 0,
  });
}
async function save(post, expected = 200) {
  const response = await context.post("/api/admin/posts", {
    headers,
    data: post,
  });
  assert.equal(response.status(), expected, `Save status (${expected})`);
  return await response.json();
}
function freshPost(overrides = {}) {
  const id = randomUUID();
  ids.push(id);
  const translation = {
    title: "Integration persistence test",
    excerpt: "A technical test article in the isolated local test database.",
    body: "This is separate technical test content, long enough for publication and never a real story.",
    coverCaption: "Technical test cover",
  };
  return {
    id,
    slug: `check-${id}`,
    category: "analysis",
    status: "draft",
    cover: "/assets/archive.webp",
    coverKind: "illustration",
    version: 0,
    ru: { ...translation, title: "Тест сохранения материала" },
    en: { ...translation },
    ...overrides,
  };
}
try {
  await seed(values.API_URL, values.SERVICE_ROLE_KEY);
  const sql = await requireCli(["test", "db"], testRoot);
  assert(
    sql.stdout.includes("All tests successful") ||
      sql.stdout.includes("Result: PASS"),
  );
  record("PostgreSQL pgTAP authorization checks");
  const mapped = await admin.from("app_owner").select("user_id");
  assert.equal(mapped.error, null);
  assert.equal(
    mapped.data.length,
    0,
    "Isolated test stack has an unexpected owner; it was not overwritten.",
  );
  ownerId = await createAccount(ownerEmail, ownerPassword);
  otherId = await createAccount(otherEmail, otherPassword);
  assert.equal(
    (
      await admin
        .from("app_owner")
        .insert({ singleton: true, user_id: ownerId })
    ).error,
    null,
  );
  await assertPortsAvailable([3400]);
  appLog = await fs.open(path.join(artifactDir, "server.log"), "w", 0o600);
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3400",
    ],
    {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", appLog.fd, appLog.fd],
    },
  );
  started = true;
  await waitApp();
  record("Production Next server reads real isolated Supabase");
  context = await request.newContext({ baseURL });
  anonContext = await request.newContext({ baseURL });
  otherContext = await request.newContext({ baseURL });
  assert.equal((await anonContext.get("/ru")).status(), 200);
  assert.equal((await anonContext.get("/en")).status(), 200);
  assert.equal(
    (
      await anonContext.get("/api/admin/posts", {
        headers: {
          "oai-authenticated-user-id": ownerId,
          "oai-authenticated-user-email": ownerEmail,
        },
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await anonContext.post("/api/admin/posts", { headers, data: freshPost() })
    ).status(),
    403,
  );
  assert.equal(
    (
      await anonContext.post("/api/admin/uploads", {
        headers: { ...headers, "Content-Type": "image/png" },
        data: Buffer.from("bad"),
      })
    ).status(),
    403,
  );
  assert.equal(
    (await login(otherContext, otherEmail, otherPassword)).headers().location,
    "/login?lang=en&error=access",
  );
  assert.equal((await otherContext.get("/api/admin/posts")).status(), 403);
  assert.equal(
    (await login(context, ownerEmail, ownerPassword)).headers().location,
    "/admin?lang=en",
  );
  record(
    "Guest, forged platform headers and non-owner denied; real owner login succeeds",
  );
  const anonymous = client(values.ANON_KEY),
    stranger = client(values.ANON_KEY),
    ownerClient = client(values.ANON_KEY);
  assert.equal(
    (
      await stranger.auth.signInWithPassword({
        email: otherEmail,
        password: otherPassword,
      })
    ).error,
    null,
  );
  assert.equal(
    (
      await ownerClient.auth.signInWithPassword({
        email: ownerEmail,
        password: ownerPassword,
      })
    ).error,
    null,
  );
  const signUp = await anonymous.auth.signUp({
    email: `signup-${randomUUID()}@example.test`,
    password: randomBytes(24).toString("hex"),
  });
  assert(signUp.error);
  const invalid = freshPost({
    en: { title: "", excerpt: "", body: "", coverCaption: "" },
  });
  const first = (await save(invalid)).post;
  assert.equal(first.version, 1);
  assert.equal(
    (await save({ ...first, status: "published" }, 400)).error,
    "translation_required",
  );
  for (const c of [anonymous, stranger]) {
    const data = await c.from("posts").select("*").eq("id", first.id);
    assert.equal(data.error, null);
    assert.equal(data.data.length, 0);
    assert((await c.from("posts").insert({ id: "forbidden" })).error);
    assert(
      (await c.from("app_owner").upsert({ singleton: true, user_id: otherId }))
        .error,
    );
    assert((await c.rpc("save_post", { p_post: first })).error);
  }
  assert(
    (
      await ownerClient
        .from("posts")
        .update({ status: "published" })
        .eq("id", first.id)
    ).error,
  );
  record(
    "Signup disabled; direct RLS/RPC/table access denies unauthorized writes and draft reads",
  );
  const foreign = await context.post("/api/admin/posts", {
    headers: { ...headers, Origin: "https://invalid.example" },
    data: freshPost(),
  });
  assert.equal(foreign.status(), 403);
  const pixel = await sharp({
    create: { width: 640, height: 400, channels: 3, background: "#d3cbc0" },
  })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(artifactDir, "upload.png"), pixel);
  let response = await context.post("/api/admin/uploads", {
    headers: { ...headers, "Content-Type": "image/png" },
    data: pixel,
  });
  assert.equal(response.status(), 201);
  const cover = (await response.json()).url;
  assert.equal((await anonContext.get(cover)).status(), 404);
  assert.equal((await context.get(cover)).status(), 200);
  for (const c of [anonymous, stranger, ownerClient])
    assert(
      (await c.storage.from("covers").createSignedUrl(cover.slice(7), 3600))
        .error,
    );
  assert(
    (
      await stranger.storage
        .from("covers")
        .upload(`${randomUUID()}.png`, pixel, { contentType: "image/png" })
    ).error,
  );
  for (const [mime, body, status] of [
    ["image/svg+xml", Buffer.from("<svg/>"), 400],
    ["image/jpeg", pixel, 400],
    ["image/png", Buffer.alloc(4 * 1024 * 1024 + 1), 413],
    ["image/png", pixel.subarray(0, 24), 400],
  ]) {
    response = await context.post("/api/admin/uploads", {
      headers: { ...headers, "Content-Type": mime },
      data: body,
    });
    assert.equal(response.status(), status);
  }
  record(
    "CSRF, MIME, invalid/oversized images rejected; real private cover upload and owner read succeed",
  );
  let full = (await save(freshPost({ cover }))).post;
  const race = await Promise.all(
    ["Concurrent A", "Concurrent B"].map((title) =>
      context.post("/api/admin/posts", {
        headers,
        data: { ...full, ru: { ...full.ru, title } },
      }),
    ),
  );
  assert.deepEqual(race.map((r) => r.status()).sort(), [200, 409]);
  // One HTTP update must lose the same-version race; inspect current version as well.

  full = (await (await context.get(`/api/admin/posts/${full.id}`)).json()).post;
  assert.equal(full.version, 2);
  assert.equal(
    (await save({ ...full, slug: "changed-slug" }, 400)).error,
    "slug_locked",
  );
  full = (await save({ ...full, status: "published" })).post;
  assert.equal(
    (await anonContext.get(`/ru/articles/${full.slug}`)).status(),
    200,
  );
  assert.equal(
    (await anonContext.get(`/en/articles/${full.slug}`)).status(),
    200,
  );
  let media = await anonContext.get(full.cover);
  assert.equal(media.status(), 200);
  assert(media.headers()["cache-control"].includes("no-store"));
  const coverHash = createHash("sha256")
    .update(await media.body())
    .digest("hex");
  full = (await save({ ...full, status: "draft" })).post;
  assert.equal(
    (await anonContext.get(`/ru/articles/${full.slug}`)).status(),
    404,
  );
  assert.equal(
    (await anonContext.get(`/en/articles/${full.slug}`)).status(),
    404,
  );
  assert.equal((await anonContext.get(full.cover)).status(), 404);
  assert.notEqual(
    (
      await anonContext.get(
        `/_next/image?url=${encodeURIComponent(full.cover)}&w=640&q=75`,
      )
    ).status(),
    200,
  );
  record(
    "Atomic version conflict, immutable slug, publish/unpublish RU+EN and immediate media protection",
  );
  const seedBefore = await admin
    .from("posts")
    .select("ru")
    .eq("id", "evidence")
    .single();
  const editedSeed = {
    ...seedBefore.data.ru,
    title: "Edited seed preservation test",
  };
  assert.equal(
    (await admin.from("posts").update({ ru: editedSeed }).eq("id", "evidence"))
      .error,
    null,
  );
  await seed(values.API_URL, values.SERVICE_ROLE_KEY);
  assert.equal(
    (await admin.from("posts").select("ru").eq("id", "evidence").single()).data
      .ru.title,
    editedSeed.title,
  );
  assert.equal(
    (
      await admin
        .from("posts")
        .update({ ru: seedBefore.data.ru })
        .eq("id", "evidence")
    ).error,
    null,
  );
  record(
    "Idempotent seed neither duplicates nor overwrites edited seed (isolated test DB)",
  );
  const list = await (await context.get("/api/admin/posts")).json();
  assert(list.posts.every((p) => !("body" in p.ru) && !("body" in p.en)));
  const ui = await runBrowserFlow({
    baseURL,
    ownerEmail,
    ownerPassword,
    otherEmail,
    otherPassword,
    fixtureImagePath: path.join(artifactDir, "upload.png"),
    artifactDir,
    onPostCreated: ({ id }) => ids.push(id),
  });
  for (const check of ui.checks ?? []) record(check);
  assert.equal((await login(context, ownerEmail, ownerPassword)).status(), 303);
  const persistedBefore = (
    await (await context.get(`/api/admin/posts/${ui.id}`)).json()
  ).post;
  const uiHash = createHash("sha256")
    .update(await (await context.get(ui.cover)).body())
    .digest("hex");
  await stopServices(true);
  await startServices(true);
  assert.equal((await login(context, ownerEmail, ownerPassword)).status(), 303);
  const persistedAfter = (
    await (await context.get(`/api/admin/posts/${ui.id}`)).json()
  ).post;
  assert.deepEqual(persistedAfter, persistedBefore);
  assert.equal(
    createHash("sha256")
      .update(await (await context.get(ui.cover)).body())
      .digest("hex"),
    uiHash,
  );
  assert.equal(
    createHash("sha256")
      .update(await (await context.get(full.cover)).body())
      .digest("hex"),
    coverHash,
  );
  record(
    "PostgreSQL articles and Storage bytes survive stop/start with volumes preserved",
  );
  const state = await context.storageState();
  replay = await request.newContext({ baseURL, storageState: state });
  assert.equal(
    (
      await context.post("/api/auth/logout", {
        headers,
        form: { lang: "en" },
        maxRedirects: 0,
      })
    ).status(),
    303,
  );
  assert.equal((await context.get("/api/admin/posts")).status(), 403);
  assert.equal((await replay.get("/api/admin/posts")).status(), 403);
  assert.equal(
    (
      await ownerClient.auth.signInWithPassword({
        email: ownerEmail,
        password: ownerPassword,
      })
    ).error,
    null,
  );
  assert.equal((await ownerClient.rpc("is_owner")).data, true);
  const token = (await ownerClient.auth.getSession()).data.session.access_token;
  await ownerClient.auth.signOut();
  const revoked = createClient(values.API_URL, values.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assert.equal((await revoked.rpc("is_owner")).data, false);
  assert((await revoked.rpc("save_post", { p_post: full })).error);
  const revokedDraft = await revoked
    .from("posts")
    .select("id")
    .eq("id", full.id);
  assert.equal(revokedDraft.error, null);
  assert.deepEqual(revokedDraft.data, []);
  record(
    "Logout revokes app access, replayed cookie and direct owner JWT authorization",
  );
  await fs.writeFile(
    path.join(artifactDir, "report.json"),
    JSON.stringify({ passed: true, checks }, null, 2),
  );
  console.log(
    `Integration checks passed: ${checks.length}. No real main-project articles or accounts were changed.`,
  );
} catch (error) {
  await fs.writeFile(
    path.join(artifactDir, "report.json"),
    JSON.stringify(
      {
        passed: false,
        checks,
        error: String(error.message)
          .replaceAll(ownerPassword, "[redacted]")
          .replaceAll(otherPassword, "[redacted]"),
      },
      null,
      2,
    ),
  );
  console.error(
    `Integration check failed: ${String(error.message).replaceAll(ownerPassword, "[redacted]").replaceAll(otherPassword, "[redacted]")}`,
  );
  process.exitCode = 1;
} finally {
  await Promise.all([
    context?.dispose(),
    anonContext?.dispose(),
    otherContext?.dispose(),
    replay?.dispose(),
  ]);
  if (started) {
    app.kill("SIGTERM");
    await new Promise((resolve) => app.once("exit", resolve));
    await appLog.close();
  }
  // Only the specifically generated accounts and their data in afterlight-test.
  if (ownerId) {
    const media = await admin
      .from("media")
      .select("key")
      .eq("owner_id", ownerId);
    // All nonseed rows belong to this isolated run, but restrict deletion to captured IDs.
    if (ids.length) await admin.from("posts").delete().in("id", ids);
    if (media.data?.length) {
      await admin.storage.from("covers").remove(media.data.map((m) => m.key));
      await admin.from("media").delete().eq("owner_id", ownerId);
    }
    await admin.from("app_owner").delete().eq("user_id", ownerId);
    await admin.auth.admin.deleteUser(ownerId);
  }
  if (otherId) await admin.auth.admin.deleteUser(otherId);
}
