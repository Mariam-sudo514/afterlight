import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv, isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import sharp from "sharp";
import { postSchema, readyToPublish } from "../lib/content.ts";
import { root, status } from "./local-lib.mjs";
import { loadCloudConfig } from "./cloud-config.mjs";

export class ContentTransferError extends Error {}
const MAX_BYTES = 4 * 1024 * 1024;
const SOURCE_URL = "http://127.0.0.1:55431";
const COLUMNS =
  "id,slug,category,status,cover,cover_kind,ru,en,version,created_at,updated_at,published_at";
const stamp = z.string().datetime({ offset: true });
const translation = z
  .object({
    title: z.string().max(160),
    excerpt: z.string().max(500),
    body: z.string().max(180000),
    coverCaption: z.string().max(300),
  })
  .strict();
const rowSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    category: z.string(),
    status: z.string(),
    cover: z.string(),
    cover_kind: z.string(),
    ru: translation,
    en: translation,
    version: z.number().int().min(1),
    created_at: stamp,
    updated_at: stamp,
    published_at: stamp.nullable(),
  })
  .strict()
  .superRefine((row, ctx) => {
    const parsed = postSchema.safeParse({ ...row, coverKind: row.cover_kind });
    if (
      !parsed.success ||
      (row.status === "published" &&
        (!row.published_at || !readyToPublish(parsed.data)))
    )
      ctx.addIssue({ code: "custom", message: "Invalid post" });
  });
const mediaSchema = z
  .object({
    key: z
      .string()
      .regex(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/,
      ),
    content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
    size: z.number().int().min(1).max(MAX_BYTES),
    width: z.number().int().positive().max(16000),
    height: z.number().int().positive().max(16000),
    created_at: stamp,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const manifestSchema = z
  .object({
    format: z.literal("afterlight-content"),
    version: z.literal(1),
    source: z.literal("afterlight-local"),
    exported_at: stamp,
    posts: z.array(rowSchema).max(10000),
    media: z.array(mediaSchema).max(10000),
  })
  .strict();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const client = (url, key) =>
  createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
function ensure(ok, message) {
  if (!ok) throw new ContentTransferError(message);
}

export function validateManifest(value) {
  const parsed = manifestSchema.safeParse(value);
  ensure(
    parsed.success,
    "Манифест не соответствует формату AFTERLIGHT. Импорт не начат.",
  );
  const manifest = parsed.data;
  ensure(
    new Set(manifest.posts.map((p) => p.id)).size === manifest.posts.length,
    "Повторяющийся ID материала.",
  );
  ensure(
    new Set(manifest.posts.map((p) => p.slug)).size === manifest.posts.length,
    "Повторяющийся slug материала.",
  );
  ensure(
    new Set(manifest.media.map((m) => m.key)).size === manifest.media.length,
    "Повторяющийся ключ обложки.",
  );
  const references = new Set(
    manifest.posts
      .filter((p) => p.cover.startsWith("/media/"))
      .map((p) => p.cover.slice(7)),
  );
  const keys = new Set(manifest.media.map((m) => m.key));
  ensure(
    keys.size === references.size &&
      [...references].every((key) => keys.has(key)),
    "Набор обложек не совпадает со ссылками статей.",
  );
  ensure(
    manifest.media.every((m) => m.width * m.height <= 40000000),
    "Обложка превышает лимит размерности.",
  );
  return manifest;
}

async function localClient() {
  const values = parseEnv(
    await fs.readFile(path.join(root, ".env.local"), "utf8"),
  );
  ensure(
    values.SUPABASE_URL === SOURCE_URL,
    "Экспорт разрешён только из основного локального AFTERLIGHT, не из тестовой базы.",
  );
  const running = await status();
  ensure(
    running?.API_URL === SOURCE_URL &&
      running.SERVICE_ROLE_KEY === values.SUPABASE_SERVICE_ROLE_KEY,
    "Основной локальный Supabase не подтверждён. Выполните pnpm local:start.",
  );
  return client(SOURCE_URL, values.SUPABASE_SERVICE_ROLE_KEY);
}

async function exportContent(directory) {
  const admin = await localClient();
  await fs.mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  await fs.mkdir(directory, { mode: 0o700 }); // Never overwrite an existing export.
  await fs.mkdir(path.join(directory, "covers"), { mode: 0o700 });
  const posts = [];
  for (let offset = 0; ; offset += 500) {
    const result = await admin
      .from("posts")
      .select(COLUMNS)
      .order("id")
      .range(offset, offset + 499);
    ensure(!result.error, "Не удалось прочитать статьи основной базы.");
    posts.push(...result.data);
    if (result.data.length < 500) break;
  }
  const media = [];
  const keys = [
    ...new Set(
      posts
        .filter((p) => p.cover.startsWith("/media/"))
        .map((p) => p.cover.slice(7)),
    ),
  ];
  for (const key of keys) {
    const row = await admin
      .from("media")
      .select("key,content_type,size,width,height,created_at")
      .eq("key", key)
      .single();
    ensure(
      !row.error,
      "Не найдены метаданные одной из обложек. Экспорт не завершён.",
    );
    const object = await admin.storage.from("covers").download(key);
    ensure(
      !object.error &&
        object.data?.size === row.data.size &&
        object.data.size <= MAX_BYTES,
      "Не удалось прочитать обложку с ожидаемым размером.",
    );
    const bytes = Buffer.from(await object.data.arrayBuffer());
    media.push({ ...row.data, sha256: digest(bytes) });
    await fs.writeFile(path.join(directory, "covers", key), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  }
  // Detect edits while the export ran; never describe a mixed snapshot as complete.
  for (const post of posts) {
    const current = await admin
      .from("posts")
      .select(COLUMNS)
      .eq("id", post.id)
      .single();
    ensure(
      !current.error && isDeepStrictEqual(current.data, post),
      "Статья изменилась во время экспорта. Повторите экспорт в новую папку после сохранения изменений.",
    );
  }
  const manifest = validateManifest({
    format: "afterlight-content",
    version: 1,
    source: "afterlight-local",
    exported_at: new Date().toISOString(),
    posts,
    media,
  });
  await fs.writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    `Экспорт завершён: ${posts.length} статей, ${media.length} обложек. Аккаунты, сессии и тестовая база не включены.`,
  );
}

async function readManifest(directory) {
  const filename = path.join(directory, "manifest.json");
  const info = await fs.lstat(filename);
  ensure(
    info.isFile() && info.size <= 64 * 1024 * 1024,
    "Некорректный файл манифеста.",
  );
  const manifest = validateManifest(
    JSON.parse(await fs.readFile(filename, "utf8")),
  );
  const binaries = new Map();
  for (const media of manifest.media) {
    const filename = path.join(directory, "covers", media.key);
    const info = await fs.lstat(filename);
    ensure(
      info.isFile() && info.size === media.size,
      "Файл обложки отсутствует или изменён.",
    );
    const bytes = await fs.readFile(filename);
    ensure(
      digest(bytes) === media.sha256,
      "Контрольная сумма обложки не совпадает.",
    );
    let image;
    try {
      image = await sharp(bytes, {
        limitInputPixels: 40000000,
        failOn: "warning",
      }).metadata();
      await sharp(bytes, { limitInputPixels: 40000000, failOn: "warning" })
        .raw()
        .toBuffer();
    } catch {
      throw new ContentTransferError("Повреждённая обложка. Импорт не начат.");
    }
    const mime = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[
      image.format
    ];
    ensure(
      image.width === media.width &&
        image.height === media.height &&
        mime === media.content_type,
      "Размерность или формат обложки не совпадает с манифестом.",
    );
    binaries.set(media.key, filename);
  }
  return { manifest, binaries };
}

function samePost(a, b) {
  const timestamps = ["created_at", "updated_at", "published_at"];
  const normalize = (p) =>
    Object.fromEntries(
      Object.entries(p).map(([key, value]) => [
        key,
        timestamps.includes(key) && value
          ? new Date(value).toISOString()
          : value,
      ]),
    );
  return isDeepStrictEqual(normalize(a), normalize(b));
}

async function importContent(directory, apply) {
  const { manifest, binaries } = await readManifest(directory);
  const config = await loadCloudConfig({ requireSecret: true });
  const admin = client(config.url, config.secretKey);
  const owner = await admin
    .from("app_owner")
    .select("user_id")
    .eq("singleton", true)
    .single();
  ensure(
    !owner.error && owner.data?.user_id,
    "Сначала создайте облачного владельца командой pnpm cloud:owner.",
  );
  const user = await admin.auth.admin.getUserById(owner.data.user_id);
  ensure(
    !user.error && user.data.user?.email_confirmed_at,
    "Назначенный владелец не подтверждён в Auth.",
  );
  const bucket = await admin.storage.getBucket("covers");
  ensure(
    !bucket.error && bucket.data.public === false,
    "Облачный bucket covers должен быть приватным.",
  );
  const pendingPosts = [],
    pendingMedia = [];
  for (const post of manifest.posts) {
    const existing = await admin
      .from("posts")
      .select(COLUMNS)
      .eq("id", post.id)
      .maybeSingle();
    const slug = await admin
      .from("posts")
      .select("id")
      .eq("slug", post.slug)
      .maybeSingle();
    ensure(
      !existing.error && !slug.error,
      "Не удалось проверить конфликт статей.",
    );
    ensure(
      !slug.data || slug.data.id === post.id,
      "Конфликт slug: существующие статьи не перезаписаны.",
    );
    ensure(
      !existing.data || samePost(existing.data, post),
      "Конфликт содержимого: материал с таким ID уже отличается. Перезапись запрещена.",
    );
    if (!existing.data) pendingPosts.push(post);
  }
  for (const media of manifest.media) {
    const expected = { ...media, owner_id: owner.data.user_id };
    delete expected.sha256;
    const existing = await admin
      .from("media")
      .select("key,content_type,size,width,height,created_at,owner_id")
      .eq("key", media.key)
      .maybeSingle();
    ensure(!existing.error, "Не удалось проверить метаданные обложек.");
    ensure(
      !existing.data || samePost(existing.data, expected),
      "Конфликт метаданных обложки. Перезапись запрещена.",
    );
    const object = await admin.storage.from("covers").download(media.key);
    const missing =
      object.error &&
      ["404", "400"].includes(String(object.error.statusCode)) &&
      /not found|does not exist/i.test(object.error.message);
    ensure(
      !object.error || missing,
      "Не удалось проверить наличие обложки в Storage.",
    );
    if (!object.error) {
      ensure(
        object.data.size === media.size &&
          digest(Buffer.from(await object.data.arrayBuffer())) === media.sha256,
        "Конфликт файла обложки. Перезапись запрещена.",
      );
    }
    pendingMedia.push({
      row: expected,
      upload: Boolean(missing),
      register: !existing.data,
    });
  }
  console.log(
    `Проверено: ${manifest.posts.length} статей, ${manifest.media.length} обложек; новых статей: ${pendingPosts.length}.`,
  );
  if (!apply) {
    console.log(
      "Dry-run: облачные данные не изменены. Для переноса повторите команду с --apply.",
    );
    return;
  }
  for (const item of pendingMedia) {
    if (item.upload) {
      const bytes = await fs.readFile(binaries.get(item.row.key));
      ensure(
        digest(bytes) ===
          manifest.media.find((m) => m.key === item.row.key).sha256,
        "Файл обложки изменён после проверки; перенос остановлен.",
      );
      const r = await admin.storage.from("covers").upload(item.row.key, bytes, {
        contentType: item.row.content_type,
        upsert: false,
      });
      ensure(
        !r.error,
        "Загрузка остановлена. Существующий объект не перезаписан; повторите dry-run.",
      );
    }
    if (item.register) {
      const r = await admin.from("media").insert(item.row);
      ensure(
        !r.error,
        "Регистрация обложки остановлена. Повторите dry-run для продолжения; существующие записи не перезаписаны.",
      );
    }
  }
  // Plain INSERT is atomic for this batch and cannot overwrite a concurrent edit.
  if (pendingPosts.length) {
    const r = await admin.from("posts").insert(pendingPosts);
    ensure(
      !r.error,
      "Импорт статей остановлен при конфликте/ошибке. Повторите dry-run; существующие статьи не перезаписаны.",
    );
  }
  console.log(
    `Перенос завершён: ${pendingPosts.length} новых статей. Аккаунты не переносились; медиа принадлежат облачному владельцу.`,
  );
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  ensure(
    ["export", "import"].includes(command),
    "Используйте content:export или content:import.",
  );
  ensure(
    rest.filter((a) => a === "--apply").length <= 1 &&
      rest.every(
        (a) => !a.startsWith("--") || ["--apply", "--dry-run"].includes(a),
      ),
    "Неизвестный аргумент команды.",
  );
  const dirs = rest.filter((a) => !a.startsWith("--"));
  ensure(
    dirs.length <= 1 &&
      !(rest.includes("--apply") && rest.includes("--dry-run")),
    "Укажите одну папку и один режим импорта.",
  );
  ensure(
    command !== "export" || rest.every((a) => !a.startsWith("--")),
    "Экспорт не принимает флаги импорта.",
  );
  const directory = path.resolve(root, dirs[0] ?? "work/content-export");
  ensure(
    directory.startsWith(path.join(root, "work") + path.sep),
    "Архивы содержимого должны находиться в закрытой папке work/ этого проекта.",
  );
  if (command === "export") await exportContent(directory);
  else await importContent(directory, rest.includes("--apply"));
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  main().catch((error) => {
    console.error(
      error instanceof ContentTransferError
        ? error.message
        : "Перенос не выполнен. Проверьте миграции, облачную конфигурацию, файлы и подключение. Секреты и содержимое материалов не выведены.",
    );
    process.exitCode = 1;
  });
