import type { MetadataRoute } from "next";
import { listPostsPage } from "@/lib/server";
import { getSiteOrigin } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = getSiteOrigin();
  const entries: MetadataRoute.Sitemap = ["ru", "en"].flatMap((lang) => [
    { url: `${origin}/${lang}` },
    { url: `${origin}/${lang}/about` },
  ]);
  let page = 1;
  while (true) {
    const result = await listPostsPage(false, page);
    for (const post of result.posts) {
      for (const lang of ["ru", "en"]) {
        entries.push({
          url: `${origin}/${lang}/articles/${post.slug}`,
          lastModified: post.updatedAt,
          alternates: {
            languages: {
              ru: `${origin}/ru/articles/${post.slug}`,
              en: `${origin}/en/articles/${post.slug}`,
            },
          },
        });
      }
    }
    if (!result.hasMore) break;
    page += 1;
  }
  return entries;
}
