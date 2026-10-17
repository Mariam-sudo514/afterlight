import assert from "node:assert/strict";
import { test } from "node:test";
import { validateManifest } from "../scripts/transfer-content.mjs";

const translation = {
  title: "Technical test title",
  excerpt: "Technical test description",
  body: "This is technical test content with enough length for publication.",
  coverCaption: "Technical test illustration",
};
const post = {
  id: "test-article",
  slug: "test-article",
  category: "analysis",
  status: "published",
  cover: "/assets/archive.webp",
  cover_kind: "illustration",
  ru: translation,
  en: translation,
  version: 2,
  created_at: "2026-09-17T00:00:00Z",
  updated_at: "2026-09-17T01:00:00Z",
  published_at: "2026-09-17T01:00:00Z",
};
const manifest = {
  format: "afterlight-content",
  version: 1,
  source: "afterlight-local",
  exported_at: "2026-09-17T02:00:00Z",
  posts: [post],
  media: [],
};

test("content format preserves bilingual content and dates, and excludes accounts/test environments", () => {
  assert.deepEqual(validateManifest(manifest), manifest);
  assert.throws(() =>
    validateManifest({ ...manifest, source: "afterlight-test" }),
  );
  assert.throws(() =>
    validateManifest({
      ...manifest,
      auth_users: [{ email: "fixture@example.test" }],
    }),
  );
  assert.throws(() => validateManifest({ ...manifest, version: 99 }));
  assert.throws(
    () => validateManifest({ ...manifest, posts: [post, post] }),
    /Повторяющийся ID/,
  );
  assert.throws(
    () =>
      validateManifest({
        ...manifest,
        posts: [post, { ...post, id: "different-id" }],
      }),
    /Повторяющийся slug/,
  );
});

test("content import validation rejects incomplete publication and missing/unrelated cover files", () => {
  assert.throws(() =>
    validateManifest({
      ...manifest,
      posts: [{ ...post, en: { ...translation, body: "" } }],
    }),
  );
  assert.doesNotThrow(() =>
    validateManifest({
      ...manifest,
      posts: [{ ...post, status: "draft", en: { ...translation, body: "" } }],
    }),
  );
  assert.throws(
    () =>
      validateManifest({
        ...manifest,
        posts: [
          {
            ...post,
            cover: "/media/11111111-1111-1111-1111-111111111111.webp",
          },
        ],
      }),
    /ссылками/,
  );
  assert.throws(() =>
    validateManifest({
      ...manifest,
      media: [
        {
          key: "../../secret",
          content_type: "image/webp",
          size: 100,
          width: 10,
          height: 10,
          created_at: post.created_at,
          sha256: "a".repeat(64),
        },
      ],
    }),
  );
});
