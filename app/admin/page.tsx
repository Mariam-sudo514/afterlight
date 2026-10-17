import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { editorIdentity } from "@/lib/auth";
import { listPostsPage } from "@/lib/server";
import { Editor } from "@/components/editor";
import type { Locale } from "@/lib/content";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Editor",
  robots: { index: false, follow: false },
};

function Unavailable({ locale }: { locale: Locale }) {
  const en = locale === "en";
  return (
    <main className="error-page" lang={locale}>
      <h1>
        {en
          ? "The editor is temporarily unavailable"
          : "Редактор временно недоступен"}
      </h1>
      <p>
        {en
          ? "Your saved articles are unchanged. Please try again."
          : "Сохранённые статьи не изменились. Попробуйте ещё раз."}
      </p>
      <Link className="read-button" href={`/admin?lang=${locale}`}>
        {en ? "Try again" : "Повторить"}
      </Link>
    </main>
  );
}

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  const locale = lang === "en" ? "en" : "ru";
  let editor;
  try {
    editor = await editorIdentity();
  } catch {
    return <Unavailable locale={locale} />;
  }
  if (!editor) redirect(`/login?lang=${locale}`);
  let result;
  try {
    result = await listPostsPage(true);
  } catch {
    return <Unavailable locale={locale} />;
  }
  return (
    <Editor
      key={locale}
      initialPosts={result.posts}
      initialPage={result.page}
      initialHasMore={result.hasMore}
      locale={locale}
      name={editor.displayName}
    />
  );
}
