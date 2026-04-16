/**
 * Git clone & cache layer.
 *
 * Handles cloning the iOS repo on first use, caching it locally, and
 * pulling latest changes from the `dev` branch on demand.
 *
 * Cache location (in priority order):
 *   1. --cache-dir <path>
 *   2. WALLET_IOS_CACHE env var
 *   3. ~/.wallet-ios-mcp/repo
 */
import { execSync, ExecSyncOptions } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const DEFAULT_BRANCH = "dev";

export interface GitCacheConfig {
  repoUrl: string;
  branch: string;
  cacheDir: string;
}

export interface SyncResult {
  alreadyUpToDate: boolean;
  previousHead: string;
  currentHead: string;
  filesChanged: number;
  summary: string;
}

/** Resolve where the cached repo lives on disk. */
export function resolveCacheDir(): string {
  const args = process.argv.slice(2);

  const cacheDirIdx = args.indexOf("--cache-dir");
  if (cacheDirIdx !== -1 && args[cacheDirIdx + 1]) {
    return args[cacheDirIdx + 1];
  }

  if (process.env.WALLET_IOS_CACHE) {
    return process.env.WALLET_IOS_CACHE;
  }

  return join(homedir(), ".wallet-ios-mcp", "repo");
}

/** Resolve the repo URL from CLI args or env. */
export function resolveRepoUrl(): string | undefined {
  const args = process.argv.slice(2);

  const urlIdx = args.indexOf("--repo-url");
  if (urlIdx !== -1 && args[urlIdx + 1]) {
    return args[urlIdx + 1];
  }

  return process.env.WALLET_IOS_REPO_URL || undefined;
}

/** Resolve the branch to track. */
export function resolveBranch(): string {
  const args = process.argv.slice(2);

  const branchIdx = args.indexOf("--branch");
  if (branchIdx !== -1 && args[branchIdx + 1]) {
    return args[branchIdx + 1];
  }

  return process.env.WALLET_IOS_BRANCH || DEFAULT_BRANCH;
}

function git(
  cmd: string,
  cwd: string,
  opts?: { timeout?: number }
): string {
  const execOpts: ExecSyncOptions = {
    cwd,
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    timeout: opts?.timeout ?? 120_000,
    stdio: ["pipe", "pipe", "pipe"],
  };

  try {
    return execSync(`git ${cmd}`, execOpts) as string;
  } catch (e: any) {
    throw new Error(
      `git ${cmd} failed:\n${e.stderr || e.stdout || e.message}`
    );
  }
}

/** Check if a directory is a valid git repo with the expected remote. */
function isValidCache(cacheDir: string, repoUrl: string): boolean {
  if (!existsSync(join(cacheDir, ".git"))) return false;
  try {
    const remote = git("remote get-url origin", cacheDir).trim();
    // Normalise URLs for comparison (https vs ssh, trailing .git)
    const normalise = (u: string) =>
      u
        .replace(/\.git$/, "")
        .replace(/^git@github\.com:/, "https://github.com/")
        .toLowerCase();
    return normalise(remote) === normalise(repoUrl);
  } catch {
    return false;
  }
}

/**
 * Ensure the repo is cloned and on the right branch. Returns the repo path.
 *
 * - If already cached and valid → just return the path (no network call).
 * - If cache exists but wrong remote → wipe and re-clone.
 * - If no cache → clone fresh.
 */
export async function ensureRepo(config: GitCacheConfig): Promise<string> {
  const { repoUrl, branch, cacheDir } = config;

  if (isValidCache(cacheDir, repoUrl)) {
    // Make sure we're on the right branch (local checkout)
    try {
      const currentBranch = git("rev-parse --abbrev-ref HEAD", cacheDir).trim();
      if (currentBranch !== branch) {
        console.error(`Switching from ${currentBranch} to ${branch}...`);
        git(`checkout ${branch}`, cacheDir);
      }
    } catch {
      // If branch doesn't exist locally, fetch and checkout
      git(`fetch origin ${branch}`, cacheDir, { timeout: 300_000 });
      git(`checkout -B ${branch} origin/${branch}`, cacheDir);
    }
    return cacheDir;
  }

  // Clone fresh
  console.error(`Cloning ${repoUrl} (branch: ${branch}) into ${cacheDir}...`);
  console.error("This may take a few minutes on first run.");

  // Ensure parent directory exists
  const parentDir = join(cacheDir, "..");
  mkdirSync(parentDir, { recursive: true });

  // If directory exists but is invalid, remove it
  if (existsSync(cacheDir)) {
    execSync(`rm -rf ${shellEscape(cacheDir)}`, { timeout: 30_000 });
  }

  // Shallow clone (depth=1) for speed — we only need the latest snapshot.
  // Use --single-branch to avoid fetching all branches.
  // Skip LFS on clone; it's not needed for code reading.
  const cloneCmd = [
    `clone`,
    `--branch ${branch}`,
    `--single-branch`,
    `--depth 1`,
    `--filter=blob:none`,
    shellEscape(repoUrl),
    shellEscape(cacheDir),
  ].join(" ");

  execSync(`GIT_LFS_SKIP_SMUDGE=1 git ${cloneCmd}`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    timeout: 600_000, // 10 min for initial clone
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Write metadata file so we can track when last synced
  writeSyncMeta(cacheDir, branch);

  console.error(`Clone complete → ${cacheDir}`);
  return cacheDir;
}

/**
 * Pull latest changes from origin. Returns a summary of what changed.
 */
export async function syncRepo(config: GitCacheConfig): Promise<SyncResult> {
  const { repoUrl, branch, cacheDir } = config;

  if (!isValidCache(cacheDir, repoUrl)) {
    // Need to clone first
    await ensureRepo(config);
    const currentHead = git("rev-parse --short HEAD", cacheDir).trim();
    return {
      alreadyUpToDate: false,
      previousHead: "(none)",
      currentHead,
      filesChanged: -1,
      summary: `Fresh clone completed. HEAD is now at ${currentHead}.`,
    };
  }

  const previousHead = git("rev-parse --short HEAD", cacheDir).trim();

  // Fetch latest
  console.error(`Fetching latest from origin/${branch}...`);
  git(`fetch origin ${branch}`, cacheDir, { timeout: 300_000 });

  // Check if we're behind
  const localHead = git("rev-parse HEAD", cacheDir).trim();
  const remoteHead = git(`rev-parse origin/${branch}`, cacheDir).trim();

  if (localHead === remoteHead) {
    writeSyncMeta(cacheDir, branch);
    return {
      alreadyUpToDate: true,
      previousHead,
      currentHead: previousHead,
      filesChanged: 0,
      summary: `Already up to date at ${previousHead}.`,
    };
  }

  // Count what changed
  let diffStat = "";
  let filesChanged = 0;
  try {
    diffStat = git(`diff --stat HEAD..origin/${branch}`, cacheDir);
    const lines = diffStat.trim().split("\n");
    // Last line is summary like " 42 files changed, 200 insertions(+), 100 deletions(-)"
    const summaryLine = lines[lines.length - 1];
    const fileMatch = summaryLine.match(/(\d+) files? changed/);
    filesChanged = fileMatch ? parseInt(fileMatch[1], 10) : 0;
  } catch {
    // Non-fatal
  }

  // Reset to remote HEAD (we're treating the cache as read-only)
  git(`reset --hard origin/${branch}`, cacheDir);
  const currentHead = git("rev-parse --short HEAD", cacheDir).trim();

  writeSyncMeta(cacheDir, branch);

  return {
    alreadyUpToDate: false,
    previousHead,
    currentHead,
    filesChanged,
    summary: [
      `Updated ${previousHead} → ${currentHead}`,
      `${filesChanged} files changed.`,
      diffStat ? `\n${diffStat}` : "",
    ].join("\n"),
  };
}

/** Get sync metadata (last sync time, head, etc.). */
export function getSyncStatus(cacheDir: string): {
  exists: boolean;
  lastSync?: string;
  head?: string;
  branch?: string;
} {
  const metaPath = join(cacheDir, ".wallet-ios-mcp-meta.json");
  if (!existsSync(metaPath)) {
    return { exists: existsSync(join(cacheDir, ".git")) };
  }

  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    let head: string | undefined;
    try {
      head = git("rev-parse --short HEAD", cacheDir).trim();
    } catch {
      // Not fatal
    }
    return {
      exists: true,
      lastSync: meta.lastSync,
      head,
      branch: meta.branch,
    };
  } catch {
    return { exists: existsSync(join(cacheDir, ".git")) };
  }
}

function writeSyncMeta(cacheDir: string, branch: string) {
  const metaPath = join(cacheDir, ".wallet-ios-mcp-meta.json");
  const meta = {
    lastSync: new Date().toISOString(),
    branch,
  };
  try {
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    // Non-fatal — metadata is convenience only
  }
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
