"use client";
/* eslint-disable @next/next/no-img-element -- Covers use the authorized /media route directly; an image optimizer cache must not retain unpublished media. */

import Link from "next/link";
import { useEditor } from "./editor/use-editor";
import { StoryList } from "./editor/story-list";
import { TranslationFields } from "./editor/translation-fields";
import {
  type Locale,
  type PostSummary,
  type PostInput,
  categories,
  categoryLabels,
  readyToPublish,
} from "@/lib/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

import { labels } from "./editor/labels";
import { ArrowIcon } from "@/components/ui/arrow-icon";

export function Editor({
  initialPosts,
  initialPage = 1,
  initialHasMore = false,
  locale,
  name,
}: {
  initialPosts: PostSummary[];
  initialPage?: number;
  initialHasMore?: boolean;
  locale: Locale;
  name: string;
}) {
  const t = labels[locale];
  const {
    posts,
    page,
    hasMore,
    post,
    lang,
    setLang,
    mode,
    setMode,
    busy,
    loading,
    uploading,
    error,
    notice,
    leave,
    setLeave,
    bodyRef,
    fileRef,
    confirmLeave,
    dirty,
    locked,
    loadPage,
    begin,
    leaveTo,
    backToList,
    field,
    translation,
    save,
    upload,
    format,
  } = useEditor(
    { posts: initialPosts, page: initialPage, hasMore: initialHasMore },
    locale,
  );
  return (
    <div
      className="admin-shell"
      lang={locale}
      onClickCapture={(event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const link = target.closest("a");
        if (
          !link ||
          link.target === "_blank" ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        )
          return;
        if (dirty || locked) {
          event.preventDefault();
          event.stopPropagation();
          leaveTo(() => window.location.assign(link.href));
        }
      }}
    >
      <header className="admin-header">
        <Link prefetch={false} className="footer-brand" href={`/${locale}`}>
          AFTERLIGHT<span>.</span>
        </Link>
        <span className="admin-desk">{t.desk}</span>
        <div className="admin-header-actions">
          <nav className="language-switch" aria-label="Language">
            <Link
              prefetch={false}
              href="/admin?lang=ru"
              aria-current={locale === "ru" ? "page" : undefined}
            >
              RU
            </Link>
            <span>/</span>
            <Link
              prefetch={false}
              href="/admin?lang=en"
              aria-current={locale === "en" ? "page" : undefined}
            >
              EN
            </Link>
          </nav>
          <Link
            prefetch={false}
            href={`/${locale}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.journal}
            <ArrowIcon />
          </Link>
          <form
            action="/api/auth/logout"
            method="post"
            onSubmit={(event) => {
              if (dirty || locked) {
                event.preventDefault();
                const form = event.currentTarget;
                leaveTo(() => form.submit());
              }
            }}
          >
            <input type="hidden" name="lang" value={locale} />
            <button type="submit" disabled={locked}>
              {t.signOut}
            </button>
          </form>
        </div>
      </header>
      {!post ? (
        <StoryList
          posts={posts}
          locale={locale}
          name={name}
          error={error}
          loading={loading}
          page={page}
          hasMore={hasMore}
          begin={begin}
          loadPage={loadPage}
        />
      ) : (
        <main className="admin-main">
          <div className="editor-top">
            <Button
              variant="ghost"
              className="text-link"
              disabled={locked}
              onClick={backToList}
            >
              <ArrowIcon direction="left" />
              {t.back}
            </Button>
            <span className={`status-label ${post.status}`}>
              {post.status === "published" ? t.published : t.draft}
            </span>
            <span className="save-state">
              {dirty ? t.unsaved : t.noChanges}
            </span>
          </div>
          <div className="editor-title">
            <h1>
              {post[locale].title ||
                post.ru.title ||
                post.en.title ||
                t.newHeading}
            </h1>
            <p>{post.status === "published" ? t.liveNote : t.draftNote}</p>
          </div>
          <div className="editor-actions">
            <Button
              className="read-button"
              disabled={locked}
              onClick={() => save(post.status)}
            >
              {busy
                ? t.saving
                : post.status === "published"
                  ? t.update
                  : t.save}
            </Button>
            {post.status === "draft" ? (
              <Button
                variant="outline"
                className="secondary-button"
                disabled={locked}
                onClick={() => save("published")}
              >
                {t.publish}
                <ArrowIcon />
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  className="secondary-button"
                  disabled={locked}
                  onClick={() => save("draft")}
                >
                  {t.unpublish}
                </Button>
                <Link
                  prefetch={false}
                  className="text-link"
                  href={`/ru/articles/${post.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t.openRu}
                  <ArrowIcon />
                </Link>
                <Link
                  prefetch={false}
                  className="text-link"
                  href={`/en/articles/${post.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t.openEn}
                  <ArrowIcon />
                </Link>
              </>
            )}
          </div>
          {error && (
            <p className="editor-alert error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="editor-alert success" role="status">
              {notice}
            </p>
          )}
          <fieldset className="editor-fields" disabled={locked}>
            <div className="editor-layout">
              <aside className="editor-settings">
                <label className="field">
                  <span>{t.category}</span>
                  <Select
                    value={post.category}
                    onValueChange={(value) =>
                      field("category", value as PostInput["category"])
                    }
                  >
                    <SelectTrigger className="editor-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((category) => (
                        <SelectItem key={category} value={category}>
                          {categoryLabels[locale][category]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="field">
                  <span>{t.slug}</span>
                  <Input
                    className="editor-input"
                    value={post.slug}
                    disabled={post.version > 0}
                    maxLength={100}
                    onChange={(e) => field("slug", e.target.value)}
                    aria-describedby="slug-help"
                  />
                  <small id="slug-help">{t.slugHelp}</small>
                </label>
                <div className="field">
                  <span>{t.cover}</span>
                  {post.cover && (
                    <img
                      className="editor-cover-preview"
                      src={post.cover}
                      alt={post[lang].coverCaption || t.cover}
                      width={600}
                      height={400}
                    />
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    onChange={(e) => void upload(e.target.files?.[0])}
                  />
                  <Button
                    variant="outline"
                    type="button"
                    className="secondary-button"
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? t.uploading : t.upload}
                  </Button>
                  <small>{t.uploadHelp}</small>
                  <details className="cover-options">
                    <summary>{t.pickExisting}</summary>
                    <div>
                      {["house", "archive", "forest"].map((name, i) => (
                        <button
                          type="button"
                          key={name}
                          onClick={() => {
                            field("cover", `/assets/${name}.webp`);
                            field("coverKind", "illustration");
                          }}
                          aria-label={`${t.cover} ${i + 1}`}
                        >
                          <img
                            src={`/assets/${name}.webp`}
                            alt=""
                            width={100}
                            height={70}
                          />
                        </button>
                      ))}
                    </div>
                  </details>
                </div>
                <label className="field">
                  <span>{t.coverKind}</span>
                  <Select
                    value={post.coverKind}
                    onValueChange={(value) =>
                      field("coverKind", value as PostInput["coverKind"])
                    }
                  >
                    <SelectTrigger className="editor-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["photo", "illustration", "document"] as const).map(
                        (kind) => (
                          <SelectItem value={kind} key={kind}>
                            {t[kind]}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </label>
                <p className="publish-help">
                  {readyToPublish(post) ? t.ready : t.requirements}
                </p>
              </aside>
              <TranslationFields
                post={post}
                locale={locale}
                lang={lang}
                setLang={setLang}
                mode={mode}
                setMode={setMode}
                bodyRef={bodyRef}
                translation={translation}
                format={format}
              />
            </div>
          </fieldset>
        </main>
      )}
      <AlertDialog open={leave} onOpenChange={setLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.leaveTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.leaveBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.stay}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLeave}>
              {t.leave}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
