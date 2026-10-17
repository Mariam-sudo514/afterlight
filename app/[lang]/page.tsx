/* eslint-disable @next/next/no-img-element -- Covers use the authorized /media route directly; an image optimizer cache must not retain unpublished media. */
import Link from "next/link";
import { getSiteOrigin } from "@/lib/config";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { listPostsPage, parsePage } from "@/lib/server";
import { categoryLabels, isLocale, POSTS_PAGE_SIZE } from "@/lib/content";
import { words } from "@/lib/i18n";
import {
  Header,
  Footer,
  EditorialNote,
  Principles,
} from "@/components/site-chrome";
import { StoryCard } from "@/components/story-card";
import { ArrowIcon } from "@/components/ui/arrow-icon";
export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ page?: string }>;
};
export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const page = parsePage((await searchParams).page);
  const t = words(lang),
    origin = getSiteOrigin(),
    query = page > 1 ? `?page=${page}` : "";
  const title = page > 1 ? `${t.tagline} — ${page}` : t.tagline;
  return {
    title,
    description: t.method,
    alternates: {
      canonical: `${origin}/${lang}${query}`,
      languages: {
        ru: `${origin}/ru${query}`,
        en: `${origin}/en${query}`,
        "x-default": `${origin}/ru${query}`,
      },
    },
    openGraph: {
      type: "website",
      title,
      description: t.method,
      url: `${origin}/${lang}${query}`,
      locale: lang === "ru" ? "ru_RU" : "en_US",
    },
  };
}
export default async function Home({ params, searchParams }: Props) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = words(lang),
    result = await listPostsPage(false, parsePage((await searchParams).page)),
    { posts, page, hasMore } = result,
    feature = page === 1 ? posts[0] : undefined,
    text = feature?.[lang],
    stories = page === 1 ? posts.slice(1) : posts;
  const firstIndex = (page - 1) * POSTS_PAGE_SIZE + (page === 1 ? 2 : 1);
  return (
    <div className="site-shell">
      <Link prefetch={false} className="skip" href="#main">
        {t.skip}
      </Link>
      <Header locale={lang} />
      <main id="main">
        {feature && text ? (
          <section
            className="feature"
            id="feature"
            aria-labelledby="feature-title"
          >
            <div className="feature-copy">
              <div className="eyebrow">
                <span className="accent">{t.featured}</span>
                <span className="tiny-divider">/</span>
                {categoryLabels[lang][feature.category].toUpperCase()}
              </div>
              <h1 id="feature-title">
                {feature.id === "krugersdorp" &&
                text.title ===
                  (lang === "ru"
                    ? "Крюгерсдорп: по ту сторону веры"
                    : "Krugersdorp: The Other Side of Faith") ? (
                  lang === "ru" ? (
                    <>
                      Крюгерсдорп:
                      <br />
                      по ту сторону
                      <br />
                      <em>веры</em>
                      <span className="red-period">.</span>
                    </>
                  ) : (
                    <>
                      Krugersdorp:
                      <br />
                      the other side
                      <br />
                      of <em>faith</em>
                      <span className="red-period">.</span>
                    </>
                  )
                ) : (
                  text.title
                )}
              </h1>
              <p className="feature-description">{text.excerpt}</p>
              <div className="feature-action">
                <Link
                  prefetch={false}
                  className="read-button"
                  href={`/${lang}/articles/${feature.slug}`}
                >
                  {t.open}
                  <ArrowIcon size="button" />
                </Link>
                <span className="feature-category">
                  {feature.readingMinutes[lang]} {t.minutes}
                </span>
              </div>
              <div className="feature-bottom">
                <span>
                  AF <b>001</b>
                </span>
                <span>{t.documented}</span>
              </div>
            </div>
            <figure className="feature-visual">
              <img
                src={feature.cover}
                alt={text.coverCaption}
                width={1000}
                height={1100}
                fetchPriority="high"
              />
              <div className="photo-top" aria-hidden="true">
                <span>AF / 001</span>
                <span>{t.focus.toUpperCase()}</span>
              </div>
              <figcaption>
                <span className="photo-caption-line" />
                <span>{text.coverCaption}</span>
                <span className="illustration-label">
                  {t[feature.coverKind].toUpperCase()}
                </span>
              </figcaption>
            </figure>
          </section>
        ) : page === 1 ? (
          <section className="empty-reading">
            <h1>{t.empty}</h1>
            <p>{t.noPosts}</p>
          </section>
        ) : null}
        <section className="stories-section" id="stories">
          <div className="section-heading">
            <div>
              <span className="section-index">01 — {t.section}</span>
              <h2>{t.details}</h2>
            </div>
            <span className="section-note">{t.more}</span>
          </div>
          <div className="stories-row">
            {stories.slice(0, 2).map((post, i) => (
              <StoryCard
                key={post.id}
                post={post}
                locale={lang}
                index={firstIndex + i}
              />
            ))}
            <EditorialNote locale={lang} />
            {stories.slice(2).map((post, i) => (
              <StoryCard
                key={post.id}
                post={post}
                locale={lang}
                index={firstIndex + i + 2}
              />
            ))}
          </div>
          {(page > 1 || hasMore) && (
            <nav
              className="list-pagination"
              aria-label={lang === "ru" ? "Страницы материалов" : "Story pages"}
            >
              {page > 1 && (
                <Link
                  className="secondary-button"
                  href={`/${lang}?page=${page - 1}#stories`}
                >
                  <ArrowIcon direction="left" />
                  {lang === "ru" ? "Назад" : "Previous"}
                </Link>
              )}
              <span>
                {lang === "ru" ? "Страница" : "Page"} {page}
              </span>
              {hasMore && (
                <Link
                  className="secondary-button"
                  href={`/${lang}?page=${page + 1}#stories`}
                >
                  {lang === "ru" ? "Далее" : "Next"}
                  <ArrowIcon direction="right" />
                </Link>
              )}
            </nav>
          )}
        </section>
        <Principles locale={lang} />
      </main>
      <Footer locale={lang} />
    </div>
  );
}
