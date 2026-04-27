import { z } from "zod";
import { syncRepo, getSyncStatus, GitCacheConfig } from "../git-cache.js";
import { getRepoRoot } from "../repo.js";

export const syncRepoSchema = z.object({
  action: z.enum(["sync", "status"]).optional().default("sync")
    .describe("'sync' pulls latest changes. 'status' shows current cache state without fetching."),
});

export type SyncRepoInput = z.infer<typeof syncRepoSchema>;

let _config: GitCacheConfig | null = null;

export function setSyncConfig(config: GitCacheConfig) {
  _config = config;
}

export async function syncRepoTool(input: SyncRepoInput): Promise<string> {
  const cacheDir = getRepoRoot();

  if (input.action === "status") {
    const status = getSyncStatus(cacheDir);
    if (!status.exists) return "No cached repo found. The repo will be cloned on first tool call.";
    return [
      "# Repo Cache Status",
      `  Path: ${cacheDir}`,
      `  Branch: ${status.branch || "unknown"}`,
      `  HEAD: ${status.head || "unknown"}`,
      `  Last synced: ${status.lastSync || "unknown"}`,
    ].join("\n");
  }

  if (!_config) return "Error: Repo URL not configured. The server must be started with --repo-url.";

  const result = await syncRepo(_config);
  return [
    "# Repo Sync Result",
    "",
    result.summary,
    "",
    `  Branch: ${_config.branch}`,
    `  Cache: ${_config.cacheDir}`,
    `  Last synced: ${new Date().toISOString()}`,
  ].join("\n");
}
