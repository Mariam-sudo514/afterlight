"use client";

import { useEffect, useRef, useState } from "react";
import {
  blankPost,
  toPostSummary,
  type Locale,
  type Post,
  type PostInput,
  type PostSummary,
} from "@/lib/content";
import { errors, labels } from "./labels";

type Page = { posts: PostSummary[]; page: number; hasMore: boolean };

export function useEditor(initialPage: Page, locale: Locale) {
  const t = labels[locale];
  const [posts, setPosts] = useState(initialPage.posts);
  const [page, setPage] = useState(initialPage.page);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [post, setPost] = useState<PostInput | null>(null);
  const [snapshot, setSnapshot] = useState("");
  const [lang, setLang] = useState<Locale>(locale);
  const [mode, setMode] = useState("write");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [leave, setLeave] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const dirty = post !== null && JSON.stringify(post) !== snapshot;
  const locked = busy || uploading || loading;

  // Root layouts persist across client navigation, so keep the document language current.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    if (!dirty && !uploading && !busy) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, uploading, busy]);

  function message(code: string) {
    return (errors[code] ?? errors.unavailable)[locale === "ru" ? 0 : 1];
  }

  async function loadPage(nextPage: number) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/posts?page=${nextPage}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as Page & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "unavailable");
      setPosts(data.posts);
      setPage(data.page);
      setHasMore(data.hasMore);
    } catch (error) {
      setError(message(error instanceof Error ? error.message : "unavailable"));
    } finally {
      setLoading(false);
    }
  }

  async function begin(item?: PostSummary) {
    if (locked) return;
    setLoading(true);
    setError("");
    try {
      let next: PostInput;
      if (item) {
        const response = await fetch(
          `/api/admin/posts/${encodeURIComponent(item.id)}`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as { post: Post; error?: string };
        if (!response.ok) throw new Error(data.error ?? "unavailable");
        next = data.post;
      } else {
        next = blankPost();
        next.slug = `story-${next.id.slice(0, 8)}`;
      }
      setPost(next);
      setSnapshot(JSON.stringify(next));
      setNotice("");
      setMode("write");
      setLang(locale);
    } catch (error) {
      setError(message(error instanceof Error ? error.message : "unavailable"));
    } finally {
      setLoading(false);
    }
  }

  function leaveTo(action: () => void) {
    if (locked) return;
    if (dirty) {
      pending.current = action;
      setLeave(true);
    } else action();
  }

  function backToList() {
    leaveTo(() => {
      setPost(null);
      setNotice("");
      void loadPage(page);
    });
  }

  function confirmLeave() {
    const action = pending.current;
    pending.current = null;
    action?.();
  }

  function field<K extends keyof PostInput>(key: K, value: PostInput[K]) {
    setPost((current) => (current ? { ...current, [key]: value } : current));
    setNotice("");
  }

  function translation(
    key: "title" | "excerpt" | "body" | "coverCaption",
    value: string,
  ) {
    setPost((current) =>
      current
        ? { ...current, [lang]: { ...current[lang], [key]: value } }
        : current,
    );
    setNotice("");
  }

  async function save(status: "draft" | "published") {
    if (!post || locked) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Afterlight-Editor": "1",
        },
        body: JSON.stringify({ ...post, status }),
      });
      const data = (await response.json()) as { error?: string; post: Post };
      if (!response.ok) throw new Error(data.error ?? "unavailable");
      const saved = data.post;
      setPosts((items) =>
        items.map((item) =>
          item.id === saved.id ? toPostSummary(saved) : item,
        ),
      );
      setPost(saved);
      setSnapshot(JSON.stringify(saved));
      setNotice(
        status === "published"
          ? post.status === "published"
            ? t.saved
            : t.publishedOk
          : post.status === "published"
            ? t.unpublishOk
            : t.draftOk,
      );
    } catch (error) {
      setError(message(error instanceof Error ? error.message : "unavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file?: File) {
    if (!file || locked) return;
    if (file.size > 4 * 1024 * 1024) {
      setError(message("too_large"));
      return;
    }
    setUploading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/uploads", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Afterlight-Editor": "1",
        },
        body: file,
      });
      const data = (await response.json()) as { error?: string; url: string };
      if (!response.ok) throw new Error(data.error ?? "unavailable");
      field("cover", data.url);
    } catch (error) {
      setError(message(error instanceof Error ? error.message : "unavailable"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function format(kind: "bold" | "heading" | "link") {
    if (!post) return;
    const input = bodyRef.current;
    const start = input?.selectionStart ?? post[lang].body.length;
    const end = input?.selectionEnd ?? start;
    const selection = post[lang].body.slice(start, end) || t.body;
    const added =
      kind === "bold"
        ? `**${selection}**`
        : kind === "heading"
          ? `\n\n## ${selection}\n\n`
          : `[${selection}](https://)`;
    translation(
      "body",
      post[lang].body.slice(0, start) + added + post[lang].body.slice(end),
    );
    setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(start, start + added.length);
    }, 0);
  }

  return {
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
  };
}
