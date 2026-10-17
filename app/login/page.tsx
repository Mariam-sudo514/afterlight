/* eslint-disable @next/next/no-html-link-for-pages -- Locale changes must reload the root layout's html lang. */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { editorIdentity } from "@/lib/auth";
import { ArrowIcon } from "@/components/ui/arrow-icon";
import "./login.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Вход редактора / Editor sign in",
  robots: { index: false, follow: false },
};

const errors = {
  ru: {
    credentials:
      "Не удалось войти. Проверьте адрес электронной почты и пароль.",
    access:
      "У этого аккаунта нет доступа к редактору. Войдите с аккаунтом владельца.",
    rate_limit:
      "Слишком много попыток входа. Подождите 15 минут и попробуйте снова.",
    unavailable: "Сервис входа временно недоступен. Попробуйте ещё раз.",
  },
  en: {
    credentials: "Sign-in failed. Check your email address and password.",
    access:
      "This account cannot access the editor. Sign in with the owner’s account.",
    rate_limit: "Too many sign-in attempts. Wait 15 minutes and try again.",
    unavailable: "Sign-in is temporarily unavailable. Please try again.",
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; error?: string }>;
}) {
  const query = await searchParams;
  const locale = query.lang === "en" ? "en" : "ru";
  const en = locale === "en";
  let owner = null;
  let unavailable = false;
  try {
    owner = await editorIdentity();
  } catch {
    unavailable = true;
  }
  if (owner) redirect(`/admin?lang=${locale}`);
  const errorKey = unavailable ? "unavailable" : query.error;
  const errorMessage =
    errorKey && Object.hasOwn(errors[locale], errorKey)
      ? errors[locale][errorKey as keyof typeof errors.ru]
      : null;

  return (
    <main className="error-page login-page" lang={locale}>
      <div className="login-top">
        <Link href={`/${locale}`} className="footer-brand">
          AFTERLIGHT<span>.</span>
        </Link>
        <nav
          className="language-switch"
          aria-label={en ? "Interface language" : "Язык интерфейса"}
        >
          <a href="/login?lang=ru" aria-current={!en ? "page" : undefined}>
            RU
          </a>
          <span aria-hidden="true">/</span>
          <a href="/login?lang=en" aria-current={en ? "page" : undefined}>
            EN
          </a>
        </nav>
      </div>
      <h1>{en ? "The editor’s desk" : "Кабинет редактора"}</h1>
      <p>
        {en
          ? "Sign in with the journal owner’s email and password. The journal is open to all readers."
          : "Войдите с электронной почтой и паролем владельца. Читать журнал можно без входа."}
      </p>
      {errorMessage && (
        <div className="editor-alert error" role="alert">
          {errorMessage}
        </div>
      )}
      <form
        action={`/api/auth/login?lang=${locale}`}
        method="post"
        className="login-form"
      >
        <input type="hidden" name="lang" value={locale} />
        <label className="field">
          <span>{en ? "Email" : "Электронная почта"}</span>
          <input
            className="editor-input"
            name="email"
            type="email"
            autoComplete="username"
            maxLength={254}
            required
          />
        </label>
        <label className="field">
          <span>{en ? "Password" : "Пароль"}</span>
          <input
            className="editor-input"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={1024}
            required
          />
        </label>
        <button className="read-button" type="submit">
          {en ? "Sign in" : "Войти"}
          <ArrowIcon size="button" />
        </button>
      </form>
      <Link href={`/${locale}`} className="article-link">
        {en ? "Return to the journal" : "Вернуться к журналу"}
      </Link>
    </main>
  );
}
