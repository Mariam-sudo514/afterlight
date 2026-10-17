import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnvironment, assertLocal } from "./local-lib.mjs";
export async function seed(url, key) {
  assertLocal(url);
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const texts = JSON.parse(
    await fs.readFile(
      new URL("../lib/seed-content.json", import.meta.url),
      "utf8",
    ),
  );
  const meta = [
    [
      "krugersdorp",
      "krugersdorp-beyond-faith",
      "cults",
      "house",
      "2026-09-14T10:00:00Z",
      "Художественная иллюстрация: дом за деревьями в сумерках.",
      "Artistic illustration: a house behind trees at dusk.",
    ],
    [
      "evidence",
      "behind-a-confession",
      "analysis",
      "archive",
      "2026-09-14T09:00:00Z",
      "Художественная иллюстрация: папка и архивные бумаги.",
      "Artistic illustration: a folder and archival papers.",
    ],
    [
      "unsolved",
      "a-story-without-an-ending",
      "unsolved",
      "forest",
      "2026-09-14T08:00:00Z",
      "Художественная иллюстрация: пустая дорога в туманном лесу.",
      "Artistic illustration: an empty road in a misty forest.",
    ],
  ];
  const rows = meta.map(
    ([id, slug, category, cover, date, ruCaption, enCaption]) => ({
      id,
      slug,
      category,
      cover: `/assets/${cover}.webp`,
      cover_kind: "illustration",
      status: "published",
      ru: { ...texts[id].ru, coverCaption: ruCaption },
      en: { ...texts[id].en, coverCaption: enCaption },
      version: 1,
      created_at: date,
      updated_at: date,
      published_at: date,
    }),
  );
  const { error } = await client
    .from("posts")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (error)
    throw new Error(
      `Seed failed (${error.code ?? "database"}). Existing content was not replaced.`,
    );
  console.log("Seed checked: existing article IDs were left untouched.");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    loadLocalEnvironment();
    await seed(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
