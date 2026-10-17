import Link from "next/link";
import type { Locale } from "@/lib/content";
import { words } from "@/lib/i18n";
import { editorIdentity } from "@/lib/auth";
import { ArrowIcon } from "@/components/ui/arrow-icon";
export function Header({
  locale,
  suffix = "",
}: {
  locale: Locale;
  suffix?: string;
}) {
  const t = words(locale);
  return (
    <header className="site-header" id="top">
      <div className="topline">
        <span className="edition">
          <span className="brand-mark" aria-hidden="true" />
          {t.edition}
        </span>
        <div className="header-actions">
          <nav
            className="language-switch"
            aria-label={locale === "ru" ? "Язык сайта" : "Site language"}
          >
            <a
              href={`/ru${suffix}`}
              hrefLang="ru"
              lang="ru"
              aria-current={locale === "ru" ? "page" : undefined}
            >
              RU
            </a>
            <span>/</span>
            <a
              href={`/en${suffix}`}
              hrefLang="en"
              lang="en"
              aria-current={locale === "en" ? "page" : undefined}
            >
              EN
            </a>
          </nav>
          <Link
            prefetch={false}
            className="text-link"
            href={`/${locale}/about`}
          >
            {t.about}
            <ArrowIcon />
          </Link>
        </div>
      </div>
      <Link
        prefetch={false}
        className="masthead"
        href={`/${locale}`}
        aria-label="AFTERLIGHT"
      >
        AFTERLIGHT
        <span className="masthead-dot" aria-hidden="true">
          .
        </span>
      </Link>
      <div className="masthead-bottom">
        <p>{t.tagline}</p>
        <p>{t.strap}</p>
      </div>
      <nav
        className="main-nav"
        aria-label={locale === "ru" ? "Главная навигация" : "Main navigation"}
      >
        <div className="nav-links">
          <Link
            prefetch={false}
            className={suffix === "" ? "active" : ""}
            href={`/${locale}`}
          >
            {t.home}
          </Link>
          <Link prefetch={false} href={`/${locale}#stories`}>
            {t.stories}
          </Link>
          <Link
            prefetch={false}
            className={suffix === "/about" ? "active" : ""}
            href={`/${locale}/about`}
          >
            {t.approach}
          </Link>
        </div>
        <Link
          prefetch={false}
          className="nav-feature"
          href={`/${locale}#feature`}
        >
          {t.focus}
          <ArrowIcon />
        </Link>
      </nav>
    </header>
  );
}
export async function Footer({ locale }: { locale: Locale }) {
  const t = words(locale);
  const editor = await editorIdentity().catch(() => null);
  return (
    <footer>
      <div className="footer-top">
        <Link prefetch={false} className="footer-brand" href={`/${locale}`}>
          AFTERLIGHT<span>.</span>
        </Link>
        <p>{t.forever}</p>
        <Link prefetch={false} className="back-top" href="#top">
          {t.top}
          <ArrowIcon direction="up" />
        </Link>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} AFTERLIGHT</span>
        <span>{t.artwork}</span>
        {editor && (
          <Link prefetch={false} href={`/admin?lang=${locale}`}>
            {t.editor}
            <ArrowIcon />
          </Link>
        )}
      </div>
    </footer>
  );
}
export function EditorialNote({ locale }: { locale: Locale }) {
  const t = words(locale);
  return (
    <aside className="editor-note">
      <span className="eyebrow">{t.editorial}</span>
      <span className="quote-mark" aria-hidden="true">
        “
      </span>
      <h3>
        {t.life}
        <br />
        <em>{t.lifeEm}</em>
      </h3>
      <p>{t.note}</p>
      <div className="note-rule" />
      <Link prefetch={false} className="article-link" href={`/${locale}/about`}>
        {t.principles}
        <ArrowIcon />
      </Link>
      <span className="note-brand">AFTERLIGHT</span>
    </aside>
  );
}
export function Principles({ locale }: { locale: Locale }) {
  const t = words(locale);
  return (
    <section className="principles" id="principles">
      <div className="principles-intro">
        <span className="section-index">02 — {t.approach.toUpperCase()}</span>
        <h2>
          {t.facts}
          <br />
          <em>{t.conclusions}</em>
        </h2>
      </div>
      <div className="principles-body">
        <p>{t.method}</p>
        <div className="principle-tags">
          {t.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <Link
          prefetch={false}
          className="article-link"
          href={`/${locale}/about`}
        >
          {t.learn}
          <ArrowIcon />
        </Link>
      </div>
    </section>
  );
}
