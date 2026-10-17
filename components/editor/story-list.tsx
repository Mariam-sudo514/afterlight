/* eslint-disable @next/next/no-img-element -- Covers use the authorized /media route directly; an image optimizer cache must not retain unpublished media. */
import type { Locale, PostSummary } from "@/lib/content";
import { Button } from "@/components/ui/button";
import { ArrowIcon } from "@/components/ui/arrow-icon";
import { labels } from "./labels";

type Props = {
  posts: PostSummary[];
  locale: Locale;
  name: string;
  error: string;
  loading: boolean;
  page: number;
  hasMore: boolean;
  begin: (post?: PostSummary) => Promise<void>;
  loadPage: (page: number) => Promise<void>;
};

export function StoryList({
  posts,
  locale,
  name,
  error,
  loading,
  page,
  hasMore,
  begin,
  loadPage,
}: Props) {
  const t = labels[locale];
  return (
    <main className="admin-main">
      <div className="admin-title-row">
        <div>
          <span className="eyebrow accent">AFTERLIGHT / {name}</span>
          <h1>{t.heading}</h1>
          <p>{t.intro}</p>
        </div>
        <Button
          className="read-button"
          disabled={loading}
          onClick={() => void begin()}
        >
          + {t.new}
        </Button>
      </div>
      {error && (
        <p className="editor-alert error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">{t.loading}</p>}
      <div className="admin-list" aria-busy={loading}>
        {posts.length ? (
          posts.map((item) => (
            <article className="admin-list-row" key={item.id}>
              {item.cover ? (
                <img
                  className="admin-thumb"
                  src={item.cover}
                  alt=""
                  width={140}
                  height={90}
                />
              ) : (
                <span className="admin-no-cover">AF</span>
              )}
              <div className="admin-list-content">
                <span className={`status-label ${item.status}`}>
                  {item.status === "published" ? t.published : t.draft}
                </span>
                <h2>
                  <button disabled={loading} onClick={() => void begin(item)}>
                    {item[locale].title ||
                      item.ru.title ||
                      item.en.title ||
                      t.untitled}
                  </button>
                </h2>
                {item[locale].excerpt && (
                  <p className="admin-list-excerpt">{item[locale].excerpt}</p>
                )}
                <span className="admin-date">
                  {t.updated}{" "}
                  {new Intl.DateTimeFormat(
                    locale === "ru" ? "ru-RU" : "en-GB",
                    { dateStyle: "medium", timeZone: "UTC" },
                  ).format(new Date(item.updatedAt))}{" "}
                  · RU / EN
                </span>
              </div>
              <Button
                variant="outline"
                className="secondary-button"
                disabled={loading}
                onClick={() => void begin(item)}
              >
                {t.edit}
                <ArrowIcon />
              </Button>
            </article>
          ))
        ) : (
          <p>{t.empty}</p>
        )}
      </div>
      {(page > 1 || hasMore) && (
        <nav
          className="list-pagination"
          aria-label={locale === "ru" ? "Страницы материалов" : "Story pages"}
        >
          <Button
            variant="outline"
            className="secondary-button"
            disabled={loading || page <= 1}
            onClick={() => void loadPage(page - 1)}
          >
            <ArrowIcon direction="left" />
            {t.previous}
          </Button>
          <span>
            {t.page} {page}
          </span>
          <Button
            variant="outline"
            className="secondary-button"
            disabled={loading || !hasMore}
            onClick={() => void loadPage(page + 1)}
          >
            {t.next}
            <ArrowIcon direction="right" />
          </Button>
        </nav>
      )}
    </main>
  );
}
