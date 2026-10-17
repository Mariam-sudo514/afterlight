/* eslint-disable @next/next/no-img-element -- Covers use the authorized /media route directly; an image optimizer cache must not retain unpublished media. */
import Link from "next/link";
import { getSiteOrigin } from "@/lib/config";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { publishedPost } from "@/lib/server";
import { categoryLabels, isLocale, readingMinutes } from "@/lib/content";
import { words } from "@/lib/i18n";
import { Header, Footer } from "@/components/site-chrome";
import { RichText } from "@/components/rich-text";
import { ArrowIcon } from "@/components/ui/arrow-icon";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ lang: string; slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang)) return {};
  const post = await publishedPost(slug);
  if (!post) return {};
  const SITE_ORIGIN = getSiteOrigin();
  const root = `${SITE_ORIGIN}/${lang}/articles/${post.slug}`;
  return {
    title: post[lang].title,
    description: post[lang].excerpt,
    alternates: {
      canonical: root,
      languages: {
        ru: `${SITE_ORIGIN}/ru/articles/${post.slug}`,
        en: `${SITE_ORIGIN}/en/articles/${post.slug}`,
      },
    },
    openGraph: {
      type: "article",
      title: post[lang].title,
      description: post[lang].excerpt,
      url: root,
      locale: lang === "ru" ? "ru_RU" : "en_US",
      publishedTime: post.publishedAt ?? undefined,
      modifiedTime: post.updatedAt,
      images: [
        { url: `${SITE_ORIGIN}${post.cover}`, alt: post[lang].coverCaption },
      ],
    },
  };
}
export default async function Article({ params }: Props) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();
  const post = await publishedPost(slug);
  if (!post) notFound();
  const t = words(lang),
    text = post[lang];
  return (
    <div className="site-shell">
      <Header locale={lang} suffix={`/articles/${post.slug}`} />
      <main>
        <article className="full-article">
          <Link
            prefetch={false}
            className="article-back"
            href={`/${lang}#stories`}
          >
            <ArrowIcon direction="left" />
            {t.back}
          </Link>
          <div className="eyebrow accent">
            {categoryLabels[lang][post.category].toUpperCase()}
          </div>
          <h1>{text.title}</h1>
          <p className="article-deck">{text.excerpt}</p>
          <div className="article-details">
            <span>
              {post.publishedAt &&
                new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(post.publishedAt))}
            </span>
            <span>
              {readingMinutes(text.body)} {t.minutes}
            </span>
            <span>AFTERLIGHT</span>
          </div>
          <figure className="article-cover">
            <img
              src={post.cover}
              alt={text.coverCaption}
              width={1536}
              height={1024}
            />
            <figcaption>
              <span>
                {t[post.coverKind]} · {text.coverCaption}
              </span>
            </figcaption>
          </figure>
          <div className="article-prose">
            <RichText body={text.body} />
            <div className="article-ending">
              <span className="brand-mark" />
              {t.facts} {t.conclusions}
            </div>
            <Link
              prefetch={false}
              className="article-link"
              href={`/${lang}#stories`}
            >
              <ArrowIcon direction="left" />
              {t.back}
            </Link>
          </div>
        </article>
      </main>
      <Footer locale={lang} />
    </div>
  );
}
