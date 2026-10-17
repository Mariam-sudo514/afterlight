import Link from "next/link";
export default function NotFound() {
  return (
    <main className="error-page">
      <span className="footer-brand">
        AFTERLIGHT<span>.</span>
      </span>
      <span className="eyebrow accent">404</span>
      <h1>
        Страница не найдена
        <br />
        Page not found
      </h1>
      <p>
        Материал недоступен или ещё не опубликован.
        <br />
        This story is unavailable or has not been published yet.
      </p>
      <div className="header-actions">
        <Link className="read-button" href="/ru">
          На главную
        </Link>
        <Link className="secondary-button" href="/en">
          Home in English
        </Link>
      </div>
    </main>
  );
}
