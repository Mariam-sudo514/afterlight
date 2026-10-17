import fs from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const CLOUD_PROJECT_REF = "npadcumzuahkqulhpimi";
export const CLOUD_URL = `https://${CLOUD_PROJECT_REF}.supabase.co`;
export const cloudEnvPath = path.join(root, ".env.cloud.local");
export const cloudWorkdir = path.join(root, "work/cloud-deployment");
export class CloudConfigError extends Error {}

export function httpsOrigin(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CloudConfigError(
      `Заполните ${name}: нужен полный HTTPS-адрес без пути.`,
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.port ||
    /\*/.test(value)
  ) {
    throw new CloudConfigError(
      `${name}: нужен точный HTTPS-origin без пути, порта и wildcard.`,
    );
  }
  return url.origin;
}

export function validateCloudConfig(
  values,
  { requireSecret = false, requireSite = false } = {},
) {
  if (values.SUPABASE_URL !== CLOUD_URL) {
    throw new CloudConfigError(
      `Облачный URL должен соответствовать проекту ${CLOUD_PROJECT_REF}. Локальная конфигурация не используется.`,
    );
  }
  if (
    !/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(
      values.SUPABASE_PUBLISHABLE_KEY ?? "",
    )
  ) {
    throw new CloudConfigError(
      "Заполните SUPABASE_PUBLISHABLE_KEY в .env.cloud.local ключом указанного проекта.",
    );
  }
  const secretKey = values.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (secretKey && !/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(secretKey)) {
    throw new CloudConfigError(
      "SUPABASE_SECRET_KEY должен быть серверным ключом sb_secret_ из API Keys облачного проекта.",
    );
  }
  if (requireSecret && !secretKey)
    throw new CloudConfigError(
      "Нужен серверный Secret key. Выполните pnpm cloud:setup; ввод скрыт.",
    );
  const siteOrigin = values.SITE_ORIGIN?.trim()
    ? httpsOrigin(values.SITE_ORIGIN.trim(), "SITE_ORIGIN")
    : "";
  if (requireSite && !siteOrigin)
    throw new CloudConfigError(
      "Адрес Vercel/домен ещё не задан. Заполните SITE_ORIGIN через pnpm cloud:setup.",
    );
  const allowedOrigins = values.ALLOWED_ORIGINS?.trim()
    ? [
        ...new Set(
          values.ALLOWED_ORIGINS.split(",").map((value) =>
            httpsOrigin(value.trim(), "ALLOWED_ORIGINS"),
          ),
        ),
      ]
    : siteOrigin
      ? [siteOrigin]
      : [];
  if (siteOrigin && !allowedOrigins.includes(siteOrigin))
    throw new CloudConfigError("ALLOWED_ORIGINS должен включать SITE_ORIGIN.");
  return {
    projectRef: CLOUD_PROJECT_REF,
    url: CLOUD_URL,
    publishableKey: values.SUPABASE_PUBLISHABLE_KEY,
    secretKey,
    siteOrigin,
    allowedOrigins,
  };
}

export async function loadCloudConfig(options = {}) {
  let values;
  try {
    values = parseEnv(await fs.readFile(cloudEnvPath, "utf8"));
  } catch {
    throw new CloudConfigError(
      "Создайте отдельный .env.cloud.local по .env.cloud.example. Не изменяйте .env.local.",
    );
  }
  return validateCloudConfig(values, options);
}

export function cloudEnvironment(config) {
  // Defined empty aliases prevent Next from falling back to the local .env.local.
  return {
    SUPABASE_URL: config.url,
    SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
    SUPABASE_SECRET_KEY: config.secretKey,
    SUPABASE_ANON_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    SITE_ORIGIN: config.siteOrigin,
    ALLOWED_ORIGINS: config.allowedOrigins.join(","),
  };
}

export async function writeCloudConfig(values) {
  validateCloudConfig(values);
  const names = [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SITE_ORIGIN",
    "ALLOWED_ORIGINS",
  ];
  const contents =
    "# Cloud-only. Never copy into .env.local or commit this file.\n" +
    names
      .map((name) => `${name}=${JSON.stringify(values[name] ?? "")}`)
      .join("\n") +
    "\n";
  const temporary = `${cloudEnvPath}.tmp`;
  await fs.writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
  try {
    await fs.rename(temporary, cloudEnvPath);
    await fs.chmod(cloudEnvPath, 0o600);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function prepareCloudWorkdir() {
  const directory = path.join(cloudWorkdir, "supabase");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const config = `project_id = "afterlight-cloud-${CLOUD_PROJECT_REF}"\n\n[db]\nmajor_version = 17\n\n[db.seed]\nenabled = false\n`;
  await fs.writeFile(path.join(directory, "config.toml"), config);
  await fs.mkdir(path.join(directory, "migrations"), { recursive: true });
  const source = path.join(root, "supabase/migrations");
  const names = (await fs.readdir(source)).filter((name) =>
    /^\d+_.+\.sql$/.test(name),
  );
  const existing = await fs.readdir(path.join(directory, "migrations"));
  if (existing.some((name) => !names.includes(name)))
    throw new CloudConfigError(
      "В облачной рабочей папке найдена неизвестная миграция. Проверьте её вручную; файлы не удалены.",
    );
  for (const name of names)
    await fs.copyFile(
      path.join(source, name),
      path.join(directory, "migrations", name),
    );
  return cloudWorkdir;
}
