#!/usr/bin/env node
/**
 * wallet-ios-mcp-server
 *
 * An MCP server that exposes the wallet-ios-private iOS codebase to Android
 * developers (or any MCP client). Provides tools for feature extraction,
 * code search, architecture overview, dependency mapping, and API discovery.
 *
 * Usage (URL mode — clones and caches automatically):
 *   node dist/index.js --repo-url git@github.com:blockchain/wallet-ios-private.git
 *   WALLET_IOS_REPO_URL=git@github.com:blockchain/wallet-ios-private.git node dist/index.js
 *
 * Usage (local mode — point at an existing checkout):
 *   node dist/index.js --repo-root /path/to/wallet-ios-private
 *   WALLET_IOS_REPO=/path/to/wallet-ios-private node dist/index.js
 *
 * Options:
 *   --repo-url <url>       Git repo URL (clones + caches automatically)
 *   --repo-root <path>     Path to existing local checkout (skips clone)
 *   --branch <name>        Branch to track (default: dev)
 *   --cache-dir <path>     Where to cache the cloned repo (default: ~/.wallet-ios-mcp/repo)
 *   --auto-sync            Pull latest on startup (default: false — uses cached version)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setRepoRoot, fileExists, repoPath } from "./repo.js";
import {
  resolveRepoUrl,
  resolveCacheDir,
  resolveBranch,
  ensureRepo,
  syncRepo,
  GitCacheConfig,
} from "./git-cache.js";

// Tool imports
import { listModulesSchema, listModules } from "./tools/list-modules.js";
import { getFeatureSchema, getFeature } from "./tools/get-feature.js";
import { searchCodeSchema, searchCode } from "./tools/search-code.js";
import {
  getArchitectureSchema,
  getArchitecture,
} from "./tools/get-architecture.js";
import {
  getApiEndpointsSchema,
  getApiEndpoints,
} from "./tools/get-api-endpoints.js";
import { readFileSchema, readRepoFile } from "./tools/read-file.js";
import {
  getFeatureFlagsSchema,
  getFeatureFlags,
} from "./tools/get-feature-flags.js";
import {
  syncRepoSchema,
  syncRepoTool,
  setSyncConfig,
} from "./tools/sync-repo.js";

// --- Resolve repo root (supports both URL and local modes) ---
function resolveRepoRoot(): string | undefined {
  const args = process.argv.slice(2);
  const repoRootIdx = args.indexOf("--repo-root");
  if (repoRootIdx !== -1 && args[repoRootIdx + 1]) {
    return args[repoRootIdx + 1];
  }
  if (process.env.WALLET_IOS_REPO) {
    return process.env.WALLET_IOS_REPO;
  }
  return undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

// --- Main ---
async function main() {
  const explicitRoot = resolveRepoRoot();
  const repoUrl = resolveRepoUrl();

  let root: string;
  let gitConfig: GitCacheConfig | null = null;

  if (explicitRoot) {
    // Local mode — use existing checkout directly
    root = explicitRoot;
    console.error(`Using local repo: ${root}`);
  } else if (repoUrl) {
    // URL mode — clone/cache the repo
    const cacheDir = resolveCacheDir();
    const branch = resolveBranch();
    gitConfig = { repoUrl, branch, cacheDir };

    console.error(`Repo URL: ${repoUrl}`);
    console.error(`Branch: ${branch}`);
    console.error(`Cache dir: ${cacheDir}`);

    // Clone if not cached, otherwise use existing cache
    root = await ensureRepo(gitConfig);

    // Auto-sync on startup if requested
    if (hasFlag("--auto-sync")) {
      console.error("Auto-sync enabled, pulling latest...");
      const result = await syncRepo(gitConfig);
      console.error(result.summary);
    }
  } else {
    // Fallback: try current directory
    root = process.cwd();
    console.error(`No --repo-url or --repo-root specified, using cwd: ${root}`);
  }

  setRepoRoot(root);

  // Validate repo root
  const hasModules = await fileExists(repoPath("Modules"));
  const hasProjectYml = await fileExists(repoPath("project.yml"));
  if (!hasModules || !hasProjectYml) {
    console.error(
      `Warning: ${root} doesn't look like the wallet-ios-private repo (missing Modules/ or project.yml).`
    );
    if (!repoUrl) {
      console.error(
        "Use --repo-url <git-url> to auto-clone, or --repo-root <path> for a local checkout."
      );
    }
  }

  // Set up sync tool config
  if (gitConfig) {
    setSyncConfig(gitConfig);
  }

  const server = new McpServer({
    name: "wallet-ios",
    version: "1.0.0",
  });

  // --- Register tools ---

  server.tool(
    "list_modules",
    "List all iOS modules with classification, products, and dependencies. Use filter to narrow by type (feature, platform, core) or name substring.",
    listModulesSchema.shape,
    async (input) => {
      const result = await listModules(input);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "get_feature",
    "Deep-dive into a feature module. Extracts reducers, state models, actions, API calls, views, and repository patterns. Set include_source=true to get full source code of key files.",
    getFeatureSchema.shape,
    async (input) => {
      const result = await getFeature(input);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "search_code",
    "Search the iOS codebase with regex patterns. Returns matches with surrounding context lines. Useful for finding specific implementations, patterns, or string references.",
    searchCodeSchema.shape,
    async (input) => {
      const result = await searchCode(input);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "get_architecture",
    "Get a high-level architecture overview of the iOS app. Sections: overview (structure & data flow), dependencies (module graph), patterns (TCA, Clean Arch, DI), tech_stack (frameworks & tools), or all.",
    getArchitectureSchema.shape,
    async (input) => {
      const result = await getArchitecture(input);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "get_api_endpoints",
    "Discover API endpoints, request/response models, and network calls. Optionally scope to a feature or search term. Great for understanding what backend APIs a feature depends on.",
    getApiEndpointsSchema.shape,
    async (input) => {
      const result = await getApiEndpoints(input);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "read_file",
    "Read a specific file from the iOS repo by relative path. Use after discovering paths via other tools. Supports line range selection.",
    readFileSchema.shape,
    async (input) => {
      const result = await readRepoFile(input);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "get_feature_flags",
    "Discover feature flags from the BlockchainNamespace system. Shows namespace keys (blockchain.ux.*, blockchain.app.*) and where they're used. Filter by domain like 'trade', 'kyc', 'earn'.",
    getFeatureFlagsSchema.shape,
    async (input) => {
      const result = await getFeatureFlags(input);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "sync_repo",
    "Pull latest changes from the iOS repo's dev branch, or check current sync status. Use 'sync' to update, 'status' to see when the cache was last refreshed and what commit it's at.",
    syncRepoSchema.shape,
    async (input) => {
      const result = await syncRepoTool(input);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // --- Start server ---
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`wallet-ios MCP server started (repo: ${root})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
