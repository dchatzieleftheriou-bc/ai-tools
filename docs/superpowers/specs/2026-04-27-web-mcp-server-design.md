# Web MCP Server — Design Spec

**Date:** 2026-04-27
**Target repo:** `git@github.com:blockchain/service-superapp-web-wallet.git` (aka wallet-v5-frontend)
**Approach:** Purpose-built `web-mcp-server/` — same conventions as `ios-mcp-server/` and `android-mcp-server/`, no shared package extraction.

---

## 1. Folder Structure

```
web-mcp-server/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── repo.ts          (copied verbatim from android-mcp-server)
    ├── git-cache.ts     (copied verbatim from android-mcp-server)
    └── tools/
        ├── list-modules.ts
        ├── get-feature.ts
        ├── search-code.ts
        ├── get-architecture.ts
        ├── get-api-endpoints.ts
        ├── read-file.ts
        ├── get-feature-flags.ts
        ├── sync-repo.ts
        ├── get-models.ts
        ├── get-navigation.ts
        ├── get-di-registrations.ts
        ├── get-translations.ts
        ├── get-routes.ts
        └── get-generated-api-types.ts
```

---

## 2. package.json

- `name`: `"web-mcp-server"`
- `bin`: `{ "web-mcp-server": "dist/index.js" }`
- Same dependencies as ios/android: `@modelcontextprotocol/sdk`, `glob`, `zod`
- Same scripts: `build` (tsc), `start`, `dev`, `prepublishOnly`

---

## 3. index.ts — Bootstrap

### CLI / Env vars

| Flag | Env var | Default |
|---|---|---|
| `--repo-url` | `WALLET_WEB_REPO_URL` | — |
| `--repo-root` | `WALLET_WEB_REPO` | — |
| `--branch` | — | `master` |
| `--cache-dir` | — | `~/.wallet-web-mcp/repo` |
| `--auto-sync` | — | false |

### Repo validation

Checks for `next.config.js` (or `next.config.ts`) **and** `src/pages/` (or `src/app/`) on startup. Prints a warning (not a hard exit) if either is missing, consistent with ios/android behaviour.

### Server identity

```ts
new McpServer({ name: "wallet-web", version: "1.0.0" })
```

---

## 4. Standard Tools (11)

### `list_modules`
**Input:** optional `filter` string (e.g. `"page"`, `"brokerage"`)

Enumerates four top-level source areas and emits a typed list:

| Source dir | Classification |
|---|---|
| `src/pages/**` | `page` |
| `src/features/**` | `feature` |
| `src/components/**` | `component-group` |
| `src/hooks/**` | `hook-group` |

For each entry: name, path, type, and (for pages) whether it is a dynamic route, API route, or static route.

---

### `get_feature`
**Input:** `feature` (string), `include_source` (boolean, default false)

Walks directories matching the feature name across `src/pages/`, `src/features/`, `src/components/`, and `src/hooks/`. Categorises each `.ts`/`.tsx` file as:

| Category | Detection signal |
|---|---|
| `component` | `.tsx` file, contains JSX / `React.FC` / `export default function` |
| `hook` | filename starts with `use`, or content exports a `use*` function |
| `api` | filename contains `api`, `service`, `fetcher`, or imports from `src/generated/` |
| `context` | filename contains `context` or `provider`, or uses `createContext` |
| `model` | filename contains `model`, `types`, `schema`, or exports `interface`/`type`/`z.object` |
| `test` | filename contains `.test.` or `.spec.` |
| `other` | anything else |

Emits a summary (class/interface/function names) per file. With `include_source=true`, includes full source for `component`, `hook`, and `model` files.

---

### `search_code`
**Input:** `pattern` (regex string), `file_glob` (default `"*.{ts,tsx}"`), `context_lines` (default 2), `max_results` (default 50)

Runs regex grep over the repo. Returns matches with surrounding context, file paths relative to repo root.

---

### `get_architecture`
**Input:** `section` enum: `overview | patterns | tech_stack | dependencies | all` (default `all`)

**`overview`** — hardcoded narrative covering:
- Next.js pages-router app with SSR/CSR/ISR patterns
- `src/` layout: pages, features, components, hooks, contexts, models, generated, utils
- Feature flags via Firebase Remote Config
- Internationalisation via `react-intl` + `global.translations.ts`

**`patterns`** — hardcoded narrative covering:
- React Context + custom hooks as primary state management (no Redux)
- Orval-generated type-safe axios fetchers from OpenAPI specs
- MVI-like patterns via hooks (intent → state update → UI)
- Storybook for component development

**`tech_stack`** — hardcoded narrative covering:
- Next.js (TypeScript), React, Emotion/CSS-in-JS
- Orval + axios (API layer), Firebase (flags), react-intl (i18n)
- Jest + Cypress (testing), Storybook (component dev)

**`dependencies`** — dynamic: scans `import` statements across `src/pages/`, `src/features/`, `src/components/` to build a simple cross-area dependency map (which pages import which component groups or features).

---

### `get_api_endpoints`
**Input:** optional `filter` string

Three sources, merged:

1. **Generated fetchers** — reads `src/generated/openapi/*.ts`, extracts exported function names, HTTP methods, paths, and param/response types.
2. **Direct calls** — greps for `axios.`, `fetch(`, and custom `api.` patterns in `src/`, emitting file + line context.
3. **Next.js API routes** — lists files under `src/pages/api/` and maps them to their `/api/…` URL.

---

### `read_file`
**Input:** `path` (relative to repo root), optional `start_line` / `end_line`

Reads a file, optionally sliced to a line range. Identical to ios/android.

---

### `get_feature_flags`
**Input:** optional `filter` string

Greps for:
- `remoteConfig`, `getValue`, `getBoolean`, `getString` (Firebase Remote Config)
- `useFeatureFlag`, `isEnabled`, `featureFlag` (custom hook patterns)
- Any constant/enum definitions that look like flag keys

Returns file+line context grouped by: definitions, read sites.

---

### `sync_repo`
**Input:** `action` enum: `sync | status`

Identical to ios/android — wraps `git-cache.ts` syncRepo / status reporting.

---

### `get_models`
**Input:** `feature` (string), optional `include_source` (boolean)

Finds TypeScript type definitions matching the feature name:
- `interface Foo { … }` and `type Foo = …` in `src/models/`, `src/features/`, `src/components/`
- Zod schemas: `z.object({ … })` with an exported name
- Orval-generated types in `src/generated/` matching the feature name

Emits field names, types, optionality, and (for Zod) the schema shape. With `include_source=true`, includes full source of the matched type definition files.

---

### `get_navigation_flow`
**Input:** `feature` (string)

For the matching feature/page area, finds:
- `<Link href="…">` usages — static and dynamic targets
- `useRouter()` + `router.push(…)` / `router.replace(…)` calls
- Dynamic route parameters from filename patterns `[param]` / `[...slug]`
- `next/navigation` `redirect()` / `notFound()` calls (App Router)

Emits a screen inventory (all `.tsx` components found) plus navigation edges.

---

### `get_di_registrations`
**Input:** optional `filter` string

React has no formal DI container, so this surfaces the equivalent: shared state injection points.

- `createContext` declarations — context name + type
- `<SomeContext.Provider>` usages — which components provide what
- Custom hooks that call `useContext(…)` — the consumer side
- Optional: `src/contexts/` directory listing with summaries

---

## 5. Web-Specific Tools (3)

### `get_translations`
**Input:** optional `filter` string (e.g. `"lending"`, `"kyc"`)

1. Reads `src/global.translations.ts` — emits all translation keys (optionally filtered by substring).
2. Greps for `useIntl`, `intl.formatMessage({ id:`, `<FormattedMessage id=` across `src/` — emits file+line for each usage site.
3. Groups output as: **Keys** (definitions) → **Usage sites** (consumers).

---

### `get_routes`
**Input:** optional `filter` string

Walks `src/pages/` recursively and maps every file to its Next.js URL path using standard routing rules:

| File pattern | Route type | Example URL |
|---|---|---|
| `pages/foo.tsx` | static | `/foo` |
| `pages/foo/[id].tsx` | dynamic | `/foo/:id` |
| `pages/foo/[...slug].tsx` | catch-all | `/foo/*` |
| `pages/api/foo.ts` | API route | `/api/foo` |
| `pages/index.tsx` | root | `/` |
| `pages/_app.tsx` / `_document.tsx` | special | (noted, not routable) |

Also notes whether `middleware.ts` exists and its matcher config (read from the file).

---

### `get_generated_api_types`
**Input:** optional `filter` string (e.g. `"lending"`)

1. Lists OpenAPI spec files in `openapi/` with their descriptions.
2. For each spec (or the filtered one), reads the corresponding generated file in `src/generated/openapi/` and surfaces:
   - Exported fetcher function names
   - HTTP method + path for each
   - Request parameter types (query, path, body)
   - Response type name
3. Useful for understanding what backend APIs exist without manually reading generated code.

---

## 6. What is NOT in scope

- No Storybook story explorer tool (can be added later).
- No test runner integration.
- No shared `mcp-core` package — `repo.ts` and `git-cache.ts` are copied, not extracted.
- No changes to `ios-mcp-server/` or `android-mcp-server/`.
