#!/usr/bin/env node
/**
 * android-mcp-server
 *
 * An MCP server that exposes an Android codebase to iOS developers,
 * backend engineers, or any MCP client.
 *
 * Usage:
 *   android-mcp-server --repo-url git@github.com:org/android-repo.git
 *   android-mcp-server --repo-root /path/to/android-repo
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

function resolveRepoRoot(): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--repo-root");
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  if (process.env.WALLET_ANDROID_REPO) return process.env.WALLET_ANDROID_REPO;
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

  // Validate
  const hasSettings = (await fileExists(repoPath("settings.gradle"))) || (await fileExists(repoPath("settings.gradle.kts")));
  const hasApp = await fileExists(repoPath("app"));
  if (!hasSettings || !hasApp) {
    console.error(`Warning: ${root} doesn't look like an Android repo (missing settings.gradle or app/).`);
  }

  if (gitConfig) setSyncConfig(gitConfig);

  const server = new McpServer({ name: "wallet-android", version: "1.0.0" });

  // --- Register tools ---

  server.tool(
    "list_modules",
    "List all Android Gradle modules with classification (feature, core, common, payments, etc.) and project dependencies.",
    listModulesSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await listModules(input) }] })
  );

  server.tool(
    "get_feature",
    "Deep-dive into a feature module. Extracts ViewModels, state/intent models, Composable screens, API calls, repositories, Koin modules, and navigation. Set include_source=true for full source.",
    getFeatureSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getFeature(input) }] })
  );

  server.tool(
    "search_code",
    "Search the Android codebase with regex patterns. Returns matches with context lines. Default file type: *.kt",
    searchCodeSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await searchCode(input) }] })
  );

  server.tool(
    "get_architecture",
    "High-level architecture overview: project structure, module dependency graph, patterns (MVI, Clean Arch, Koin), tech stack, or all.",
    getArchitectureSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getArchitecture(input) }] })
  );

  server.tool(
    "get_api_endpoints",
    "Discover Retrofit API interfaces, @GET/@POST endpoints, DTOs, and service wrappers. Scope by feature or search term.",
    getApiEndpointsSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getApiEndpoints(input) }] })
  );

  server.tool(
    "read_file",
    "Read a specific file from the Android repo by relative path. Supports line range selection.",
    readFileSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await readRepoFile(input) }] })
  );

  server.tool(
    "get_feature_flags",
    "Discover feature flags — FeatureFlag implementations, key constants, and .coEnabled()/.enabled usage sites.",
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
    "Extract data classes, DTOs, sealed interfaces, and enums for a feature. Shows field names, types, defaults, and @Serializable annotations — everything needed to build the Swift Codable equivalent.",
    getModelsSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getModels(input) }] })
  );

  server.tool(
    "get_navigation_flow",
    "Trace Compose Navigation: NavHost, route registrations, NavController.navigate() calls, NavigationEvent sealed classes, deep links, and @Composable screen inventory.",
    getNavigationSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getNavigation(input) }] })
  );

  server.tool(
    "get_di_registrations",
    "Show Koin dependency injection registrations: viewModel {}, factory {}, single {}, scoped {}, and named qualifiers. Scope to a feature or see all.",
    getDiRegistrationsSchema.shape,
    async (input) => ({ content: [{ type: "text", text: await getDiRegistrations(input) }] })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`wallet-android MCP server started (repo: ${root})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
