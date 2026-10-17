import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import {
  ask,
  secret,
  assertInteractiveTerminal,
  TerminalInputError,
} from "./terminal-input.mjs";
import {
  assertLocal,
  loadLocalEnvironment,
  root,
  status,
} from "./local-lib.mjs";

class SetupError extends Error {}

async function newPassword() {
  const first = await secret("Пароль (ввод скрыт, минимум 12 символов): ");
  if ([...first].length < 12 || Buffer.byteLength(first, "utf8") > 72) {
    throw new SetupError(
      "Пароль должен содержать минимум 12 символов и не более 72 байт UTF-8.",
    );
  }
  const second = await secret("Повторите пароль (ввод скрыт): ");
  if (first !== second)
    throw new SetupError("Пароли не совпадают. Изменения не выполнены.");
  return first;
}

export function parseOwnerArguments(args) {
  if (
    args.some((arg) => !["--cloud", "--reset-password"].includes(arg)) ||
    new Set(args).size !== args.length
  ) {
    throw new SetupError(
      "Команды: pnpm local:owner [--reset-password] или pnpm cloud:owner [--reset-password]. Пароль не передаётся аргументом.",
    );
  }
  return {
    cloud: args.includes("--cloud"),
    reset: args.includes("--reset-password"),
  };
}

export function validateCloudAuthSettings(settings) {
  if (settings?.disable_signup !== true) {
    throw new SetupError(
      "В облачном Supabase сначала отключите публичную регистрацию: Authentication → Sign In / Providers → Allow new users to sign up. Владелец не создан.",
    );
  }
  if (settings.external?.email !== true) {
    throw new SetupError(
      "В облачном Supabase включите Email provider, сохранив запрет публичной регистрации. Владелец не создан.",
    );
  }
  if (settings.external?.anonymous_users !== false) {
    throw new SetupError(
      "В облачном Supabase отключите Anonymous Sign-Ins. Владелец не создан.",
    );
  }
}

async function ownerConnection(cloud) {
  if (cloud) {
    const { loadCloudConfig } = await import("./cloud-config.mjs");
    const config = await loadCloudConfig({
      requireSecret: true,
      requireSite: false,
    });
    // A cloud invocation never reads .env.local or accepts an alternate project.
    if (
      config.projectRef !== "npadcumzuahkqulhpimi" ||
      config.url !== "https://npadcumzuahkqulhpimi.supabase.co"
    ) {
      throw new SetupError(
        "Облачный режим допускает только утверждённый Supabase-проект AFTERLIGHT.",
      );
    }
    let response;
    try {
      response = await fetch(`${config.url}/auth/v1/settings`, {
        headers: { apikey: config.publishableKey },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new SetupError(
        "Не удалось проверить облачный Auth. Проверьте подключение и .env.cloud.local.",
      );
    }
    if (!response.ok)
      throw new SetupError(
        "Не удалось проверить облачный Auth. Проверьте Publishable key в .env.cloud.local.",
      );
    let settings;
    try {
      settings = await response.json();
    } catch {
      throw new SetupError(
        "Облачный Auth вернул неизвестный ответ. Владелец не создан.",
      );
    }
    validateCloudAuthSettings(settings);
    return {
      url: config.url,
      secretKey: config.secretKey,
      siteOrigin: config.siteOrigin,
    };
  }

  loadLocalEnvironment();
  const local = parseEnv(
    await fs.readFile(path.join(root, ".env.local"), "utf8"),
  );
  if (!local.SUPABASE_URL || !local.SUPABASE_SERVICE_ROLE_KEY) {
    throw new SetupError(
      "Сначала выполните pnpm local:start для подготовки локальной среды.",
    );
  }
  assertLocal(local.SUPABASE_URL);
  const running = await status();
  if (
    !running ||
    running.API_URL !== local.SUPABASE_URL ||
    running.SERVICE_ROLE_KEY !== local.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new SetupError(
      "Локальный проект AFTERLIGHT не запущен или .env.local не соответствует ему. Выполните pnpm local:start.",
    );
  }
  return {
    url: local.SUPABASE_URL,
    secretKey: local.SUPABASE_SERVICE_ROLE_KEY,
    siteOrigin: local.SITE_ORIGIN,
  };
}

export async function main(args = process.argv.slice(2)) {
  const { cloud, reset } = parseOwnerArguments(args);
  assertInteractiveTerminal();
  const command = cloud ? "pnpm cloud:owner" : "pnpm local:owner";
  const scope = cloud ? "облачного" : "локального";
  const connection = await ownerConnection(cloud);
  // Read only this project's file, not inherited service credentials from another shell/project.
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(connection.url, connection.secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  if (cloud) {
    // A real administrative request proves the supplied key belongs to this exact
    // project. No accounts or their details are displayed or modified here.
    const verified = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (verified.error || !Array.isArray(verified.data?.users)) {
      throw new SetupError(
        "Секретный ключ не подтвердил административный доступ к облачному AFTERLIGHT. Владелец не создан.",
      );
    }
  }
  const { data: existing, error: lookupError } = await admin
    .from("app_owner")
    .select("user_id")
    .eq("singleton", true)
    .maybeSingle();
  if (lookupError)
    throw new SetupError(
      cloud
        ? "Не удалось проверить владельца облачного AFTERLIGHT. Сначала примените миграции к утверждённому проекту."
        : "Не удалось проверить владельца. Проверьте pnpm local:status и миграции.",
    );

  if (reset) {
    if (!existing)
      throw new SetupError(
        `Владелец ещё не назначен. Сначала выполните ${command}.`,
      );
    const { data, error } = await admin.auth.admin.getUserById(
      existing.user_id,
    );
    if (error || !data.user?.email || !data.user.email_confirmed_at)
      throw new SetupError("Не удалось найти аккаунт назначенного владельца.");
    const email = await ask("Электронная почта существующего владельца: ");
    if (email.toLowerCase() !== data.user.email.toLowerCase())
      throw new SetupError(
        "Почта не совпадает с назначенным владельцем. Изменения не выполнены.",
      );
    let password = await newPassword();
    try {
      const result = await admin.auth.admin.updateUserById(existing.user_id, {
        password,
      });
      if (result.error)
        throw new SetupError(
          "Не удалось обновить пароль. Попробуйте снова после проверки Auth.",
        );
      console.log(`Пароль ${scope} владельца обновлён. Войдите через /login.`);
    } finally {
      password = "";
    }
    return;
  }

  if (existing) {
    console.log(
      `Владелец уже назначен. Аккаунт и права не изменены. Для смены пароля: ${command} --reset-password`,
    );
    return;
  }
  const email = (await ask("Электронная почта владельца: ")).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new SetupError("Некорректный адрес электронной почты.");
  const displayName = await ask("Имя в редакторе (необязательно): ");
  if (displayName.length > 80)
    throw new SetupError("Имя должно содержать не более 80 символов.");
  let password = await newPassword();
  let user;
  try {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName || email },
    });
    if (created.error || !created.data.user) {
      throw new SetupError(
        "Аккаунт не создан. Убедитесь, что эта почта ещё не используется и Auth доступен. Существующие аккаунты не изменены.",
      );
    }
    user = created.data.user;
  } finally {
    password = "";
  }
  if (!user.email_confirmed_at) {
    await admin.auth.admin.deleteUser(user.id);
    throw new SetupError(
      "Auth не подтвердил адрес нового аккаунта. Владелец не назначен.",
    );
  }

  const { error: assignmentError } = await admin
    .from("app_owner")
    .insert({ singleton: true, user_id: user.id });
  if (assignmentError) {
    // A failed response can arrive after a committed insert. Confirm before cleanup.
    const confirmed = await admin
      .from("app_owner")
      .select("user_id")
      .eq("singleton", true)
      .maybeSingle();
    if (confirmed.data?.user_id !== user.id) {
      // Roll back only the account created in this run. The owner FK also prevents
      // removal if another request successfully assigned this exact account.
      const cleanup = await admin.auth.admin.deleteUser(user.id);
      throw new SetupError(
        cleanup.error
          ? "Назначение владельца не подтверждено. Новый аккаунт сохранён без изменения существующего владельца; проверьте Supabase Studio выбранного проекта."
          : "Владелец не назначен. Созданный этой командой аккаунт удалён; существующие данные не изменены.",
      );
    }
  }
  console.log(
    `Аккаунт ${scope} владельца создан и назначен.${connection.siteOrigin ? ` Вход: ${connection.siteOrigin}/login?lang=ru` : " Войдите через /login после настройки адреса сайта."}`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  main().catch((error) => {
    // Only the fixed messages above are emitted; never print SDK errors or request bodies.
    console.error(
      error instanceof SetupError || error instanceof TerminalInputError
        ? error.message
        : process.argv.includes("--cloud")
          ? "Операция не выполнена. Проверьте .env.cloud.local, облачный Auth и миграции AFTERLIGHT. Пароль и ключи не выводятся."
          : "Операция не выполнена. Проверьте pnpm local:status и наличие .env.local после pnpm local:start. Пароль и ключи не выводятся.",
    );
    process.exitCode = 1;
  });
