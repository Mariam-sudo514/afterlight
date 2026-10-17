import { getSiteOrigin } from "@/lib/config";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isLocale } from "@/lib/content";
import { Header, Footer } from "@/components/site-chrome";
import { words } from "@/lib/i18n";
import { RichText } from "@/components/rich-text";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ lang: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const SITE_ORIGIN = getSiteOrigin();
  return {
    title: words(lang).about,
    description: words(lang).method,
    openGraph: {
      title: words(lang).about,
      description: words(lang).method,
      url: `${SITE_ORIGIN}/${lang}/about`,
      type: "website",
      locale: lang === "ru" ? "ru_RU" : "en_US",
    },
    alternates: {
      canonical: `${SITE_ORIGIN}/${lang}/about`,
      languages: {
        ru: `${SITE_ORIGIN}/ru/about`,
        en: `${SITE_ORIGIN}/en/about`,
      },
    },
  };
}
const body = {
  ru: `AFTERLIGHT — независимый true crime журнал о преступлениях, людях и поиске правды. Нас интересует не только то, что произошло, но и то, как об этом стало известно.

## Источники важнее драматургии

Судебные документы, официальные сообщения и проверяемые публикации составляют основу материалов. Свидетельства, обвинения и установленные обстоятельства получают свои точные обозначения. Пробелы в информации не заполняются вымыслом.

## Люди важнее образа преступника

Мы не романтизируем насилие и не превращаем преступников в героев. Подробности жестокости включаются только тогда, когда без них нельзя понять дело.

## Иллюстрация — не улика

Художественные обложки всегда помечены как иллюстрации. Их нельзя принимать за фотографии реальных мест преступлений, документы или вещественные доказательства.

## Два языка, одна история

Материалы выходят на русском и английском. Переводы сохраняют факты и смысл оригинала. Тексты и их переводы проходят редакционную проверку перед публикацией.`,
  en: `AFTERLIGHT is an independent true crime journal about crimes, people and the search for truth. We care not only about what happened, but about how it became known.

## Sources before storytelling

Court documents, official statements and verifiable reporting form the foundation of our stories. Testimony, allegations and established facts are clearly distinguished. Gaps in the record are not filled with invention.

## People before the criminal's image

We do not romanticize violence or turn offenders into heroes. Graphic details are included only when they are necessary to understand a case.

## An illustration is not evidence

Artistic covers are always labeled as illustrations. They must not be mistaken for photographs of actual crime scenes, documents or physical evidence.

## Two languages, one story

Stories appear in Russian and English. Translations preserve the facts and meaning of the original. Both versions receive editorial review before publication.`,
};
export default async function About({ params }: Props) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = words(lang);
  return (
    <div className="site-shell">
      <Header locale={lang} suffix="/about" />
      <main className="about-page">
        <span className="eyebrow accent">
          {t.about.toUpperCase()} / AFTERLIGHT
        </span>
        <h1>
          {t.life}
          <br />
          <em>{t.lifeEm}</em>
        </h1>
        <RichText body={body[lang]} />
      </main>
      <Footer locale={lang} />
    </div>
  );
}
