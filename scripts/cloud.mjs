import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  root,
  CLOUD_PROJECT_REF,
  cloudWorkdir,
  CloudConfigError,
  loadCloudConfig,
  writeCloudConfig,
  prepareCloudWorkdir,
  cloudEnvironment,
} from "./cloud-config.mjs";
import {
  ask,
  secret,
  assertInteractiveTerminal,
  TerminalInputError,
} from "./terminal-input.mjs";

function runCli(args, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["exec", "supabase", ...args, "--workdir", cloudWorkdir],
      {
        cwd: root,
        env: { ...process.env, ...environment },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", () =>
      reject(new CloudConfigError("Не удалось запустить Supabase CLI.")),
    );
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      // CLI diagnostics may include connection credentials. Emit fixed messages only.
      if (/access token not provided|unauthorized|not logged in/i.test(stderr))
        return reject(
          new CloudConfigError(
            "Supabase CLI не авторизован. Выполните pnpm exec supabase login в терминале.",
          ),
        );
      if (/password|authentication|SASL/i.test(stderr))
        return reject(
          new CloudConfigError(
            "Нужна авторизация базы. Выполните pnpm cloud:link и введите пароль БД скрыто в терминале.",
          ),
        );
      reject(
        new CloudConfigError(
          `Supabase ${args[0]} ${args[1] ?? ""} не выполнен. Проверьте доступ к проекту и сети; исходные логи скрыты, чтобы не раскрывать реквизиты.`,
        ),
      );
    });
  });
}

function runCliInteractive(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["exec", "supabase", ...args, "--workdir", cloudWorkdir],
      {
        cwd: root,
        env: { ...process.env },
        // Supabase CLI owns the password prompt and disables terminal echo.
        stdio: "inherit",
      },
    );
    child.on("error", () =>
      reject(new CloudConfigError("Не удалось запустить Supabase CLI.")),
    );
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(
        new CloudConfigError(
          "Облачная привязка не выполнена. Проверьте авторизацию CLI и пароль БД; исходные логи не сохраняются приложением.",
        ),
      );
    });
  });
}

async function verifiedProject() {
  await loadCloudConfig();
  await prepareCloudWorkdir();
  const projects = JSON.parse(await runCli(["projects", "list", "-o", "json"]));
  const project = projects.find((project) => project.id === CLOUD_PROJECT_REF);
  if (!project)
    throw new CloudConfigError(
      "У текущего аккаунта CLI нет указанного проекта. Другой проект не будет использован.",
    );
  const link = path.join(cloudWorkdir, "supabase/.temp/project-ref");
  try {
    if ((await fs.readFile(link, "utf8")).trim() !== CLOUD_PROJECT_REF)
      throw new CloudConfigError(
        "Облачная рабочая папка связана с другим проектом. Привязка не изменена.",
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log(
    `Проверен проект ${CLOUD_PROJECT_REF}; регион: ${project.region ?? "не указан API"}.`,
  );
}

async function authSettings(config) {
  let response;
  try {
    response = await fetch(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new CloudConfigError(
      "Облачный Supabase недоступен по сети. Ключи не выведены; локальные настройки не изменены.",
    );
  }
  if (!response.ok)
    throw new CloudConfigError(
      "Publishable key не принят указанным облачным проектом. Проверьте URL и ключ в .env.cloud.local.",
    );
  return response.json();
}

async function check() {
  const config = await loadCloudConfig();
  const settings = await authSettings(config);
  console.log("URL и Publishable key приняты облачным Auth.");
  console.log(
    `Публичная регистрация: ${settings.disable_signup === true ? "отключена" : "ВКЛЮЧЕНА — отключите Allow new users to sign up в Authentication → Sign In / Providers"}.`,
  );
  console.log(
    `Email/password provider: ${settings.external?.email === true ? "включён" : "выключен"}.`,
  );
  const client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client
    .from("post_summaries")
    .select("id", { count: "exact" })
    .limit(1);
  const schemaReady =
    result.status === 200 && !result.error && Array.isArray(result.data);
  console.log(
    !schemaReady
      ? "Схема AFTERLIGHT пока недоступна читателю. После авторизации выполните cloud:plan / cloud:migrate."
      : `Публичный список доступен; опубликованных статей: ${result.count}.`,
  );
  if (config.secretKey) {
    const admin = createClient(config.url, config.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if ((await admin.auth.admin.listUsers({ page: 1, perPage: 1 })).error)
      throw new CloudConfigError(
        "Secret key не принят указанным облачным проектом.",
      );
    const bucket = await admin.storage.getBucket("covers");
    if (bucket.error || bucket.data.public)
      throw new CloudConfigError(
        "Приватное хранилище covers ещё не готово. Выполните проверенные миграции.",
      );
    console.log("Серверный ключ принят; bucket covers приватный.");
  } else
    console.log("Secret key ещё не задан. Следующий шаг: pnpm cloud:setup.");
  if (!config.siteOrigin)
    console.log(
      "Адрес Vercel/домен ещё не задан; SITE_ORIGIN оставлен пустым.",
    );
  if (
    settings.disable_signup !== true ||
    settings.external?.email !== true ||
    !schemaReady ||
    !config.secretKey ||
    !config.siteOrigin
  )
    process.exitCode = 1;
}

async function setup() {
  assertInteractiveTerminal();
  const current = await loadCloudConfig();
  console.log(
    `Облачный проект: ${CLOUD_PROJECT_REF}. .env.local и локальная база не изменяются.`,
  );
  let key = await secret(
    "Supabase Secret key (ввод скрыт; Enter — оставить текущее значение): ",
  );
  try {
    const site = await ask(
      "HTTPS-адрес Vercel/домен (Enter — оставить прежний или пока пустой): ",
    );
    const origins = await ask(
      "Дополнительные разрешённые HTTPS-origin через запятую (Enter — без изменения): ",
    );
    const siteOrigin = site || current.siteOrigin;
    const allowed = origins
      ? [siteOrigin, ...origins.split(",")].filter(Boolean).join(",")
      : site
        ? siteOrigin
        : current.allowedOrigins.join(",");
    await writeCloudConfig({
      SUPABASE_URL: current.url,
      SUPABASE_PUBLISHABLE_KEY: current.publishableKey,
      SUPABASE_SECRET_KEY: key || current.secretKey,
      SITE_ORIGIN: siteOrigin,
      ALLOWED_ORIGINS: allowed,
    });
    console.log(
      ".env.cloud.local сохранён с правами0600. Значения ключей не выведены.",
    );
  } finally {
    key = "";
  }
}

async function link() {
  await verifiedProject();
  assertInteractiveTerminal();
  console.log(
    "Supabase CLI запросит пароль PostgreSQL скрыто. Локальная привязка не изменяется.",
  );
  await runCliInteractive(["link", "--project-ref", CLOUD_PROJECT_REF]);
  console.log(
    "Облачная привязка подготовлена отдельно в work/cloud-deployment.",
  );
}

async function plan(apply) {
  await verifiedProject();
  const preflightFile = path.join(
    root,
    "supabase/snippets/cloud-preflight.sql",
  );
  const output = await runCli([
    "db",
    "query",
    "--linked",
    "--project-ref",
    CLOUD_PROJECT_REF,
    "--file",
    preflightFile,
    "-o",
    "json",
  ]);
  // The SQL returns only schema/privilege metadata, never article bodies or credentials.
  const decoded = JSON.parse(output);
  const rows = Array.isArray(decoded) ? decoded : decoded.rows;
  const report = rows?.[0]?.report;
  if (!report || typeof report !== "object")
    throw new CloudConfigError(
      "Не удалось прочитать отчёт схемы. Миграции не применены.",
    );
  await fs.writeFile(
    path.join(cloudWorkdir, "preflight.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  if (report.safe_to_apply !== true)
    throw new CloudConfigError(
      "Предварительная проверка обнаружила несовместимую/неизвестную схему. Изучите work/cloud-deployment/preflight.json; существующие данные не изменены.",
    );
  await runCli([
    "db",
    "push",
    "--project-ref",
    CLOUD_PROJECT_REF,
    "--dry-run",
    "--skip-vault",
  ]);
  console.log(
    "Проверка схемы и dry-run миграций прошли. Существующие материалы и аккаунты не перезаписываются.",
  );
  if (!apply) return;
  await runCli([
    "db",
    "push",
    "--project-ref",
    CLOUD_PROJECT_REF,
    "--skip-vault",
    "--yes",
  ]);
  console.log(
    "Ожидающие миграции применены. Seed, перенос статей и аккаунтов не запускались.",
  );
}

async function build() {
  const config = await loadCloudConfig({
    requireSecret: true,
    requireSite: true,
  });
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "build", "--webpack"],
    {
      cwd: root,
      env: { ...process.env, ...cloudEnvironment(config) },
      stdio: "inherit",
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

try {
  const command = process.argv[2];
  if (process.argv.length > 3)
    throw new CloudConfigError(
      "Не передавайте секреты аргументами. Команды: setup, check, prepare, link, plan, migrate, build.",
    );
  if (command === "setup") await setup();
  else if (command === "check") await check();
  else if (command === "prepare") {
    await loadCloudConfig();
    await prepareCloudWorkdir();
    console.log(
      "Облачная рабочая папка и миграции подготовлены отдельно от локальных сервисов.",
    );
  } else if (command === "link") await link();
  else if (command === "plan" || command === "migrate")
    await plan(command === "migrate");
  else if (command === "build") await build();
  else
    throw new CloudConfigError(
      "Команды: setup, check, prepare, link, plan, migrate, build.",
    );
} catch (error) {
  console.error(
    error instanceof CloudConfigError || error instanceof TerminalInputError
      ? error.message
      : "Облачная операция не выполнена. Проверьте конфигурацию и авторизацию; секреты и исходные ошибки не выведены.",
  );
  process.exitCode = 1;
}
