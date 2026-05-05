#!/usr/bin/env node
/**
 * wallet-web-mcp-server
 *
 * An MCP server that exposes the service-superapp-web-wallet Next.js codebase
 * to AI assistants. Provides 14 tools for feature exploration, code search,
 * architecture overview, API discovery, routing, i18n, and more.
 *
 * Usage (URL mode — clones and caches automatically):
 *   node dist/index.js --repo-url git@github.com:blockchain/service-superapp-web-wallet.git
 *   WALLET_WEB_REPO_URL=git@github.com:... node dist/index.js
 *
 * Usage (local mode — point at an existing checkout):
 *   node dist/index.js --repo-root /path/to/service-superapp-web-wallet
 *   WALLET_WEB_REPO=/path/to/service-superapp-web-wallet node dist/index.js
 *
 * Options:
 *   --repo-url <url>     Git repo URL (clones + caches automatically)
 *   --repo-root <path>   Path to existing local checkout (skips clone)
 *   --branch <name>      Branch to track (default: master)
 *   --cache-dir <path>   Where to cache the cloned repo (default: ~/.wallet-web-mcp/repo)
 *   --auto-sync          Pull latest on startup (default: false)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setRepoRoot, fileExists, repoPath } from "./repo.js";
import {
  resolveRepoUrl, resolveCacheDir, resolveBranch, ensureRepo, syncRepo, GitCacheConfig,
} from "./git-cache.js";

import { listModulesSchema, listModules } from "./tools/list-modules.js";
import { getFeatureSchema, getFeature } from "./tools/get-feature.js";
import { searchCodeSchema, searchCode } from "./tools/search-code.js";
import { getArchitectureSchema, getArchitecture } from "./tools/get-architecture.js";
import { getApiEndpointsSchema, getApiEndpoints } from "./tools/get-api-endpoints.js";
import { readFileSchema, readRepoFile } from "./tools/read-file.js";
import { getFeatureFlagsSchema, getFeatureFlags } from "./tools/get-feature-flags.js";
import { syncRepoSchema, syncRepoTool, setSyncConfig } from "./tools/sync-repo.js";
import { getModelsSchema, getModels } from "./tools/get-models.js";
import { getNavigationSchema, getNavigation } from "./tools/get-navigation.js";
import { getDiRegistrationsSchema, getDiRegistrations } from "./tools/get-di-registrations.js";
import { getTranslationsSchema, getTranslations } from "./tools/get-translations.js";
import { getRoutesSchema, getRoutes } from "./tools/get-routes.js";
import { getGeneratedApiTypesSchema, getGeneratedApiTypes } from "./tools/get-generated-api-types.js";

function resolveRepoRoot(): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--repo-root");
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  if (process.env.WALLET_WEB_REPO) return process.env.WALLET_WEB_REPO;
  return undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function main() {
  const explicitRoot = resolveRepoRoot();
  const repoUrl = resolveRepoUrl();

  let root: string;
  let gitConfig: GitCacheConfig | null = null;

  if (explicitRoot) {
    root = explicitRoot;
    console.error(`Using local repo: ${root}`);
  } else if (repoUrl) {
    const cacheDir = resolveCacheDir();
    const branch = resolveBranch();
    gitConfig = { repoUrl, branch, cacheDir };
    console.error(`Repo URL: ${repoUrl}`);
    console.error(`Branch: ${branch}`);
    console.error(`Cache dir: ${cacheDir}`);
    root = await ensureRepo(gitConfig);
    if (hasFlag("--auto-sync")) {
      console.error("Auto-sync enabled, pulling latest...");
      const result = await syncRepo(gitConfig);
      console.error(result.summary);
    }
  } else {
    root = process.cwd();
    console.error(`No --repo-url or --repo-root specified, using cwd: ${root}`);
  }

  setRepoRoot(root);

  const hasNextConfig =
    (await fileExists(repoPath("next.config.js"))) ||
    (await fileExists(repoPath("next.config.ts")));
  const hasPages =
    (await fileExists(repoPath("src", "pages"))) ||
    (await fileExists(repoPath("pages")));
  if (!hasNextConfig || !hasPages) {
    console.error(
      `Warning: ${root} doesn't look like a Next.js repo (missing next.config.js or pages/).`
    );
    if (!repoUrl) {
      console.error("Use --repo-url <git-url> to auto-clone, or --repo-root <path> for a local checkout.");
    }
  }

  if (gitConfig) setSyncConfig(gitConfig);

  const server = new McpServer({ name: "wallet-web", version: "1.0.0" });

  server.tool(
    "list_modules",
    "List Next.js pages, feature modules, component groups, and hook groups. Filter by type ('page', 'feature', 'component-group', 'hook-group') or name substring.",
    listModulesSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await listModules(input) }] })
  );

  server.tool(
    "get_feature",
    "Deep-dive into a feature: finds matching files across pages, features, components, and hooks. Categorises as component, hook, API, context, model, or test. Set include_source=true for full source.",
    getFeatureSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getFeature(input) }] })
  );

  server.tool(
    "search_code",
    "Search the web codebase with regex. Searches .ts/.tsx files by default. Returns matches with surrounding context lines.",
    searchCodeSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await searchCode(input) }] })
  );

  server.tool(
    "get_architecture",
    "High-level architecture overview of the web wallet. Sections: overview (structure & data flow), patterns (Context+hooks, Orval), tech_stack (Next.js, Firebase, react-intl), dependencies (cross-area imports), or all.",
    getArchitectureSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getArchitecture(input) }] })
  );

  server.tool(
    "get_api_endpoints",
    "Discover API endpoints: Orval-generated fetchers from OpenAPI specs, direct axios/fetch calls, and Next.js API routes under pages/api/.",
    getApiEndpointsSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getApiEndpoints(input) }] })
  );

  server.tool(
    "read_file",
    "Read a specific file from the web repo by relative path. Supports line range selection.",
    readFileSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await readRepoFile(input) }] })
  );

  server.tool(
    "get_feature_flags",
    "Discover feature flags: Firebase Remote Config usage (remoteConfig, getBoolean, getValue) and custom hook patterns (useFeatureFlag, isEnabled).",
    getFeatureFlagsSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getFeatureFlags(input) }] })
  );

  server.tool(
    "sync_repo",
    "Pull latest changes from the tracked branch, or check current sync status.",
    syncRepoSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await syncRepoTool(input) }] })
  );

  server.tool(
    "get_models",
    "Extract TypeScript interfaces, type aliases, Zod schemas, and enums for a feature. Set include_source=true for full type definition source.",
    getModelsSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getModels(input) }] })
  );

  server.tool(
    "get_navigation_flow",
    "Trace Next.js navigation for a feature: Link components, router.push/replace calls, redirect(), dynamic route params, and screen component inventory.",
    getNavigationSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getNavigation(input) }] })
  );

  server.tool(
    "get_di_registrations",
    "Map React context providers: createContext definitions, .Provider usages, and useContext consumers. React's equivalent of DI registrations.",
    getDiRegistrationsSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getDiRegistrations(input) }] })
  );

  server.tool(
    "get_translations",
    "List i18n translation keys from src/global.translations.ts and find all intl.formatMessage / useIntl / FormattedMessage usage sites. Filter by feature name.",
    getTranslationsSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getTranslations(input) }] })
  );

  server.tool(
    "get_routes",
    "Map all Next.js pages to their URL paths. Distinguishes static, dynamic ([id]), catch-all ([...slug]), API routes, and special files. Also shows middleware matcher config.",
    getRoutesSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getRoutes(input) }] })
  );

  server.tool(
    "get_generated_api_types",
    "Browse Orval-generated TypeScript fetchers from OpenAPI specs. Lists specs in openapi/, then shows exported functions with HTTP methods and paths from src/generated/openapi/.",
    getGeneratedApiTypesSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getGeneratedApiTypes(input) }] })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`wallet-web MCP server started (repo: ${root})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
