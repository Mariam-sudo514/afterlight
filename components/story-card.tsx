/* eslint-disable @next/next/no-img-element -- Covers use the authorized /media route directly; an image optimizer cache must not retain unpublished media. */
import Link from "next/link";
import { categoryLabels, type Locale, type PostSummary } from "@/lib/content";
import { words } from "@/lib/i18n";
import { ArrowIcon } from "@/components/ui/arrow-icon";
export function StoryCard({
  post,
  locale,
  index,
}: {
  post: PostSummary;
  locale: Locale;
  index: number;
}) {
  const t = words(locale),
    text = post[locale],
    href = `/${locale}/articles/${post.slug}`;
  return (
    <article className="story-card">
      <Link
        prefetch={false}
        className="story-image-button"
        href={href}
        aria-label={text.title}
      >
        <img
          src={post.cover}
          alt={text.coverCaption}
          width={750}
          height={500}
          loading="lazy"
        />
        <span className="story-archive-mark" aria-hidden="true">
          A / {String(index).padStart(2, "0")}
        </span>
      </Link>
      <div className="card-meta">
        <span>{categoryLabels[locale][post.category]}</span>
      </div>
      <h3>
        <Link prefetch={false} href={href}>
          {text.title}
        </Link>
      </h3>
      <p>{text.excerpt}</p>
      <Link prefetch={false} className="article-link" href={href}>
        {t.read}
        <ArrowIcon />
      </Link>
      <span className="card-reading">
        {post.readingMinutes[locale]} {t.minutes}
      </span>
    </article>
  );
}
