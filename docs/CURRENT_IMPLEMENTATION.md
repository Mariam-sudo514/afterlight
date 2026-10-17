# AFTERLIGHT

A bilingual Russian / English true crime journal with an owner-only editor.

## Writing and publishing

Open `/admin` and sign in with the owner's ChatGPT account. Choose **New story**, upload a cover, and enter the Russian and English versions in their respective tabs. Save a draft at any point. Preview formatting before publishing. **Publish RU + EN** requires both versions and cover captions to be complete. Translations are entered and reviewed by the editor; there is no automatic translation service.

Published stories have separate `/ru/articles/<slug>` and `/en/articles/<slug>` URLs. The language switch preserves the current story. The latest published story appears first on the home page. Saved story addresses cannot be changed. Unpublishing retains all content as an editor-only draft.

## Implementation

React, TypeScript strict, Next-compatible App Router through Vinext, Tailwind 4 and the bundled accessible components. Cloudflare D1 stores posts and the editor identity. R2 stores uploaded covers. Original conceptual covers remain bundled as static assets.

The existing Sites access policy is private. This is independent of the application's published/draft status. Opening the journal to public readers is a separate hosting access change; editor routes remain protected.

## Authentication

The dispatcher authenticates ChatGPT sessions and supplies verified identity headers. `EDITOR_EMAIL` is a production secret configured to the verified owner's email. It authorizes the initial binding only. Subsequent requests use the stable Site-scoped user ID stored in `settings.editor_user_id`. Anonymous users and all other signed-in users cannot read drafts or write content. No app passwords are stored. The footer editor link is rendered server-side only for the owner; direct editor URLs and write endpoints remain independently authorized.

## Data and publishing safety

Content is stored on the server, never solely in localStorage. Saves use a revision check to prevent lost concurrent updates. Mutation routes enforce the fixed Site origin and a custom editor header. JSON and image bodies are bounded. Image uploads accept structurally checked JPEG, PNG and WebP; SVG and HTML are rejected. Unpublished covers require editor access. The Markdown renderer escapes raw HTML and restricts link protocols. Image responses use `no-store` so unpublishing takes effect on subsequent requests.

## Local commands

Node >=22.13.0 and the pnpm version declared in package.json are required. Preserve pnpm-lock.yaml and pnpm-workspace.yaml. Run the project installer before building. Cloudflare local bindings and migrations follow the bundled Sites setup.

- `pnpm run dev`: development
- `pnpm run db:generate`: generate an append-only migration after schema changes
- `pnpm run build`: build the Worker and static assets
- `node node_modules/typescript/bin/tsc --noEmit`: type check
- `node scripts/check-blog.mjs`: 17 meaningful persistence, authorization, upload and rendering checks against the real SQLite schema and application handlers (Node 24 required for built-in node:sqlite)

Schema changes are migrations only. Initial article content is imported once through idempotent prepared statements, separately from migrations. Published migration files must remain immutable.

## Content

The three original texts are available in both languages. The Krugersdorp overview cites the South African National Prosecuting Authority statement of 20 August 2019. The other two texts are editorial essays. Generated cover illustrations are explicitly labeled and are not represented as crime-scene evidence.
