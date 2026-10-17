import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

// Called only by the integration runner, which provisions ephemeral test accounts.
// No credentials, session cookies or response bodies are written to artifacts.
export async function runBrowserFlow({
  baseURL,
  ownerEmail,
  ownerPassword,
  otherEmail,
  otherPassword,
  fixtureImagePath,
  artifactDir,
  onPostCreated,
}) {
  await mkdir(artifactDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  const guest = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
  });
  const owner = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
  });
  const other = await browser.newContext({ baseURL });
  const reader = await guest.newPage();
  const editor = await owner.newPage();
  const outsider = await other.newPage();
  const checks = [];
  const pageErrors = [];
  for (const page of [reader, editor, outsider]) {
    page.on("pageerror", (error) => pageErrors.push(error.name));
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(60_000);
  }

  async function noOverflow(page) {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      "There must be no horizontal page overflow",
    );
  }
  async function login(page, email, password) {
    await page.goto("/login?lang=en");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: false }).click();
  }
  async function save(buttonName, expectedStatus = 200) {
    const responsePromise = editor.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/admin/posts" &&
        response.request().method() === "POST",
    );
    await editor
      .getByRole("button", { name: buttonName, exact: false })
      .click();
    const response = await responsePromise;
    assert.equal(
      response.status(),
      expectedStatus,
      "The editor save must have the expected HTTP status",
    );
    return response.json();
  }
  async function fillTranslation({ title, excerpt, caption, body }) {
    await editor.getByLabel("Title", { exact: true }).fill(title);
    await editor.getByLabel(/^Short description/).fill(excerpt);
    await editor
      .getByLabel("Cover caption and description", { exact: true })
      .fill(caption);
    await editor.getByLabel("Story text", { exact: true }).fill(body);
  }
  async function cardLayout(page, width) {
    const row = page.locator(".admin-list-row").first();
    const image = row.locator(".admin-thumb");
    const info = row.locator(".admin-list-content");
    const action = row.locator(".secondary-button");
    await expect(image).toBeVisible();
    const [a, b, c] = await Promise.all([
      image.boundingBox(),
      info.boundingBox(),
      action.boundingBox(),
    ]);
    assert.ok(a && b && c);
    if (width <= 640) {
      assert.ok(
        b.y >= a.y + a.height - 1 && c.y >= b.y + b.height - 1,
        "Mobile card must be cover → content → edit",
      );
      assert.ok(
        Math.abs(a.width / a.height - 16 / 9) < 0.02,
        "Mobile cover must retain its 16:9 crop",
      );
      assert.ok(
        Math.abs(a.width - b.width) < 2,
        "Mobile image and text must use the full card width",
      );
    } else {
      assert.ok(
        b.x > a.x + a.width && c.x > b.x,
        "Desktop card must stay horizontal",
      );
    }
    await noOverflow(page);
  }

  async function wholeWord(page, word) {
    const title = page.locator(".admin-list-row").first().locator("h2 button");
    const lineCount = await title.evaluate((element, value) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const start = node.textContent.indexOf(value);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + value.length);
        return range.getClientRects().length;
      }
      return 0;
    }, word);
    assert.equal(lineCount, 1, `The word ${word} must remain on one line`);
  }

  try {
    for (const lang of ["ru", "en"]) {
      for (const width of [393, 1280]) {
        await reader.setViewportSize({ width, height: 852 });
        await reader.goto(`/${lang}`);
        await expect(reader.locator("html")).toHaveAttribute("lang", lang);
        await expect(reader.locator(".feature-copy h1")).toBeVisible();
        await noOverflow(reader);
        const marks = reader.locator(".story-archive-mark");
        assert.ok(
          (await marks.count()) >= 2,
          "Seeded journal must show archive marks",
        );
        await expect(marks.first()).toHaveText("A / 02");
        await expect(marks.nth(1)).toHaveText("A / 03");
        assert.equal(
          await marks
            .first()
            .evaluate((element) => getComputedStyle(element).pointerEvents),
          "none",
        );
        assert.equal(await marks.first().getAttribute("tabindex"), null);
        assert.equal(
          await reader
            .locator(".card-meta")
            .first()
            .textContent()
            .then((value) => /A \/|\b02\b/.test(value)),
          false,
          "Archive number must not be duplicated below the cover",
        );
        assert.equal(
          await reader
            .getByRole("button", { name: /Архивная метка|Закладка|Фотоуголки/ })
            .count(),
          0,
        );
        await reader.screenshot({
          path: join(artifactDir, `journal-${lang}-${width}.png`),
          fullPage: true,
        });
      }
    }
    checks.push(
      "RU/EN public journal at 393/1280; archive marks; no horizontal overflow",
    );

    await reader.goto("/ru");
    const articleHref = await reader
      .locator(".feature-action a")
      .getAttribute("href");
    assert.ok(articleHref?.startsWith("/ru/articles/"));
    await reader.locator(".feature-action a").click();
    await expect(reader.locator(".full-article h1")).toBeVisible();
    await reader.locator('.language-switch a[lang="en"]').click();
    await expect(reader).toHaveURL(
      new URL(articleHref.replace("/ru/", "/en/"), baseURL).href,
    );
    await expect(reader.locator("html")).toHaveAttribute("lang", "en");
    await expect(reader.locator(".full-article h1")).toBeVisible();
    await reader.goto("/en");
    const coverLink = reader.locator(".story-image-button").first();
    const coverHref = await coverLink.getAttribute("href");
    await coverLink.focus();
    await reader.keyboard.press("Enter");
    await expect(reader).toHaveURL(new URL(coverHref, baseURL).href);
    checks.push(
      "Article language switch preserves slug; cover link works by keyboard",
    );

    const denied = await guest.request.get("/api/admin/posts", {
      headers: {
        "oai-authenticated-user-id": "forged-owner",
        "oai-authenticated-email": ownerEmail,
      },
    });
    assert.equal(denied.status(), 403);
    await reader.goto("/admin?lang=en");
    await expect(reader).toHaveURL(/\/login\?lang=en$/);
    await login(outsider, otherEmail, otherPassword);
    await expect(outsider).toHaveURL(/error=access/);
    await expect(outsider.locator('.editor-alert[role="alert"]')).toContainText(
      "cannot access",
    );
    assert.equal((await other.request.get("/api/admin/posts")).status(), 403);
    checks.push("Guest/forged headers/non-owner cannot access editor");

    await login(editor, ownerEmail, `${ownerPassword}invalid`);
    await expect(editor).toHaveURL(/error=credentials/);
    await login(editor, ownerEmail, ownerPassword);
    await expect(
      editor.getByRole("heading", { name: "Your stories", exact: true }),
    ).toBeVisible();
    await expect(editor.locator("html")).toHaveAttribute("lang", "en");
    await editor
      .getByRole("button", { name: "+ New story", exact: true })
      .click();
    const slug = await editor.getByLabel(/^Story address/).inputValue();
    const idFragment = slug.slice("story-".length);
    const ru = {
      title: `Проверка редактора ${idFragment}: очень длинный заголовок о сохранении обеих языковых версий и обложки`,
      excerpt:
        "Отдельный технический материал для проверки локального журнала AFTERLIGHT.",
      caption: "Тестовая обложка, созданная для проверки загрузки.",
      body: "## Проверка русского текста\n\nЭто отдельный технический материал, который проверяет сохранение обеих языковых версий.\n\n**Сохранённый текст** остаётся в настоящей базе данных.",
    };
    const en = {
      title: `Krugersdorp persistence test ${idFragment}: a deliberately long title about keeping both language versions and the cover`,
      excerpt:
        "A separate technical story for testing the local AFTERLIGHT journal.",
      caption: "A test cover generated for the upload check.",
      body: "## English persistence check\n\nThis is a separate technical story used to verify both language versions.\n\n**Saved text** remains in the real database.\n\n<script>window.afterlightUnsafe=true</script>",
    };
    await editor
      .getByRole("tab", { name: "RU · Русский", exact: true })
      .click();
    await fillTranslation(ru);
    const uploadResponse = editor.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/admin/uploads",
    );
    await editor.locator('input[type="file"]').setInputFiles(fixtureImagePath);
    assert.equal((await uploadResponse).status(), 201);
    await expect(editor.locator(".editor-cover-preview")).toHaveAttribute(
      "src",
      /^\/media\//,
    );
    await expect
      .poll(() =>
        editor
          .locator(".editor-cover-preview")
          .evaluate((image) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    let saved = (await save("Save draft")).post;
    // Register immediately: the runner can clean up this isolated test post even
    // if a later browser assertion fails before the flow returns its result.
    await onPostCreated?.({
      id: saved.id,
      slug: saved.slug,
      cover: saved.cover,
    });
    assert.ok(saved.id && saved.cover.startsWith("/media/"));
    assert.equal(saved.en.body, "");
    const incomplete = await save("Publish RU + EN", 400);
    assert.equal(incomplete.error, "translation_required");
    await editor
      .getByRole("tab", { name: "EN · English", exact: true })
      .click();
    await fillTranslation(en);
    saved = (await save("Save draft")).post;
    assert.equal(saved.ru.body, ru.body);
    assert.equal(saved.en.body, en.body);
    await editor.reload();
    await editor.getByRole("button", { name: en.title, exact: true }).click();
    await expect(editor.getByLabel("Story text", { exact: true })).toHaveValue(
      en.body,
    );
    await expect(editor.getByLabel(/^Short description/)).toHaveValue(
      en.excerpt,
    );
    await expect(
      editor.getByLabel("Cover caption and description", { exact: true }),
    ).toHaveValue(en.caption);
    await expect
      .poll(() =>
        editor
          .locator(".editor-cover-preview")
          .evaluate((image) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await editor
      .getByRole("tab", { name: "RU · Русский", exact: true })
      .click();
    await expect(editor.getByLabel("Story text", { exact: true })).toHaveValue(
      ru.body,
    );
    await editor
      .getByRole("tab", { name: "EN · English", exact: true })
      .click();
    await editor
      .getByLabel(/^Short description/)
      .fill(`${en.excerpt} Unsaved change.`);
    await editor
      .getByRole("button", { name: "All stories", exact: false })
      .click();
    await expect(editor.getByRole("alertdialog")).toBeVisible();
    await editor
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(editor.getByLabel(/^Short description/)).toHaveValue(
      `${en.excerpt} Unsaved change.`,
    );
    await editor.getByLabel(/^Short description/).fill(en.excerpt);
    await editor.getByRole("tab", { name: "Preview", exact: true }).click();
    await expect(editor.locator(".editor-reading-preview")).toContainText(
      "English persistence check",
    );
    assert.equal(
      await editor.evaluate(() => Boolean(window.afterlightUnsafe)),
      false,
    );
    assert.equal(
      (await guest.request.get(`/en/articles/${slug}`)).status(),
      404,
    );
    assert.equal((await guest.request.get(saved.cover)).status(), 404);
    checks.push(
      "Owner login/create/upload; incomplete translation rejected; RU/EN saved and reloaded; private draft/preview; unsaved guard",
    );

    saved = (await save("Publish RU + EN")).post;
    for (const lang of ["ru", "en"]) {
      await reader.goto(`/${lang}/articles/${slug}`);
      await expect(reader.locator(".full-article h1")).toHaveText(
        lang === "ru" ? ru.title : en.title,
      );
      await expect(reader.locator(".article-prose")).toContainText(
        lang === "ru"
          ? "Проверка русского текста"
          : "English persistence check",
      );
      await expect
        .poll(() =>
          reader
            .locator(".article-cover img")
            .evaluate((image) => image.naturalWidth),
        )
        .toBeGreaterThan(0);
    }
    assert.equal((await guest.request.get(saved.cover)).status(), 200);
    saved = (await save("Unpublish")).post;
    assert.equal(saved.status, "draft");
    assert.equal(
      (await guest.request.get(`/en/articles/${slug}`)).status(),
      404,
    );
    assert.equal((await guest.request.get(saved.cover)).status(), 404);
    checks.push(
      "Publication exposes both article locales and cover; unpublish revokes new guest requests",
    );

    await editor
      .getByRole("button", { name: "All stories", exact: false })
      .click();
    for (const lang of ["en", "ru"]) {
      await editor.goto(`/admin?lang=${lang}`);
      await expect(editor.locator("html")).toHaveAttribute("lang", lang);
      await expect(editor.locator(".admin-list-row").first()).toContainText(
        lang === "ru" ? ru.title : en.title,
      );
      for (const width of [320, 393, 430, 1280]) {
        await editor.setViewportSize({ width, height: 852 });
        await cardLayout(editor, width);
        if (lang === "en") await wholeWord(editor, "Krugersdorp");
        await editor.screenshot({
          path: join(artifactDir, `editor-${lang}-${width}.png`),
          fullPage: true,
        });
      }
    }
    checks.push(
      "Editor long-title cards at 320/393/430/1280 in RU/EN; vertical mobile/horizontal desktop; no overflow; Krugersdorp stays whole",
    );
    await editor.locator('form[action="/api/auth/logout"] button').click();
    await expect(editor).toHaveURL(/\/ru$/);
    assert.equal((await owner.request.get("/api/admin/posts")).status(), 403);
    await editor.goto("/admin?lang=en");
    await expect(editor).toHaveURL(/\/login\?lang=en$/);
    checks.push("Owner signout removes editor/API access");
    assert.deepEqual(
      pageErrors,
      [],
      "Browser must not throw client runtime errors",
    );
    return { id: saved.id, slug, cover: saved.cover, checks };
  } finally {
    await browser.close();
  }
}
