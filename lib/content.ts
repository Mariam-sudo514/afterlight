import { z } from "zod";

export type Locale = "ru" | "en";
export const categories = [
  "cults",
  "analysis",
  "unsolved",
  "investigations",
] as const;
export const categoryLabels = {
  ru: {
    cults: "Культы и секты",
    analysis: "Разбор",
    unsolved: "Нераскрытые дела",
    investigations: "Расследования",
  },
  en: {
    cults: "Cults & control",
    analysis: "Analysis",
    unsolved: "Unsolved cases",
    investigations: "Investigations",
  },
};
export const translationSchema = z.object({
  title: z.string().trim().max(160),
  excerpt: z.string().trim().max(500),
  body: z.string().trim().max(180000),
  coverCaption: z.string().trim().max(300),
});
export const postSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  slug: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: z.enum(categories),
  status: z.enum(["draft", "published"]),
  cover: z
    .string()
    .max(200)
    .refine(
      (v) =>
        v === "" ||
        /^\/assets\/(house|archive|forest)\.webp$/.test(v) ||
        /^\/media\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(v),
    ),
  coverKind: z.enum(["illustration", "photo", "document"]),
  ru: translationSchema,
  en: translationSchema,
  version: z.number().int().min(0).max(2147483646),
});
export type PostInput = z.infer<typeof postSchema>;
export type Post = PostInput & {
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};
export type PostSummary = Omit<Post, "ru" | "en"> & {
  ru: Omit<Post["ru"], "body">;
  en: Omit<Post["en"], "body">;
  readingMinutes: Record<Locale, number>;
};
export const POSTS_PAGE_SIZE = 12;

export function toPostSummary(post: Post): PostSummary {
  const { ru, en, ...metadata } = post;
  return {
    ...metadata,
    ru: { title: ru.title, excerpt: ru.excerpt, coverCaption: ru.coverCaption },
    en: { title: en.title, excerpt: en.excerpt, coverCaption: en.coverCaption },
    readingMinutes: {
      ru: readingMinutes(ru.body),
      en: readingMinutes(en.body),
    },
  };
}
export function isLocale(value: string): value is Locale {
  return value === "ru" || value === "en";
}
export function localeFromUrl(url: URL): Locale {
  return url.pathname === "/en" ||
    url.pathname.startsWith("/en/") ||
    (["/admin", "/login"].includes(url.pathname) &&
      url.searchParams.get("lang") === "en")
    ? "en"
    : "ru";
}
export function readyToPublish(post: PostInput): boolean {
  return (
    Boolean(post.cover) &&
    [post.ru, post.en].every(
      (t) =>
        t.title.length >= 3 &&
        t.excerpt.length >= 10 &&
        t.body.length >= 30 &&
        t.coverCaption.length >= 3,
    )
  );
}
export function blankPost(): PostInput {
  const empty = { title: "", excerpt: "", body: "", coverCaption: "" };
  return {
    id: crypto.randomUUID(),
    slug: "",
    category: "investigations",
    status: "draft",
    cover: "",
    coverKind: "photo",
    ru: { ...empty },
    en: { ...empty },
    version: 0,
  };
}
export function readingMinutes(body: string): number {
  return Math.max(1, Math.ceil(body.split(/\s+/).length / 180));
}

export function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
