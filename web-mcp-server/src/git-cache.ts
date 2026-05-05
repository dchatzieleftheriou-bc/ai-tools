import { execSync, ExecSyncOptions } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const DEFAULT_BRANCH = "master";

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

export function resolveCacheDir(): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--cache-dir");
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  if (process.env.WALLET_WEB_CACHE) return process.env.WALLET_WEB_CACHE;
  return join(homedir(), ".wallet-web-mcp", "repo");
}

export function resolveRepoUrl(): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--repo-url");
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return process.env.WALLET_WEB_REPO_URL || undefined;
}

export function resolveBranch(): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--branch");
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return process.env.WALLET_WEB_BRANCH || DEFAULT_BRANCH;
}

function git(cmd: string, cwd: string, opts?: { timeout?: number }): string {
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
    throw new Error(`git ${cmd} failed:\n${e.stderr || e.stdout || e.message}`);
  }
}

function isValidCache(cacheDir: string, repoUrl: string): boolean {
  if (!existsSync(join(cacheDir, ".git"))) return false;
  try {
    const remote = git("remote get-url origin", cacheDir).trim();
    const normalise = (u: string) =>
      u.replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/").toLowerCase();
    return normalise(remote) === normalise(repoUrl);
  } catch {
    return false;
  }
}

export async function ensureRepo(config: GitCacheConfig): Promise<string> {
  const { repoUrl, branch, cacheDir } = config;

  if (isValidCache(cacheDir, repoUrl)) {
    try {
      const currentBranch = git("rev-parse --abbrev-ref HEAD", cacheDir).trim();
      if (currentBranch !== branch) {
        console.error(`Switching from ${currentBranch} to ${branch}...`);
        git(`checkout ${branch}`, cacheDir);
      }
    } catch {
      git(`fetch origin ${branch}`, cacheDir, { timeout: 300_000 });
      git(`checkout -B ${branch} origin/${branch}`, cacheDir);
    }
    return cacheDir;
  }

  console.error(`Cloning ${repoUrl} (branch: ${branch}) into ${cacheDir}...`);
  console.error("This may take a few minutes on first run.");

  const parentDir = join(cacheDir, "..");
  mkdirSync(parentDir, { recursive: true });

  if (existsSync(cacheDir)) {
    execSync(`rm -rf ${shellEscape(cacheDir)}`, { timeout: 30_000 });
  }

  const cloneCmd = [
    "clone",
    `--branch ${branch}`,
    "--single-branch",
    "--depth 1",
    "--filter=blob:none",
    shellEscape(repoUrl),
    shellEscape(cacheDir),
  ].join(" ");

  execSync(`GIT_LFS_SKIP_SMUDGE=1 git ${cloneCmd}`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    timeout: 600_000,
    stdio: ["pipe", "pipe", "pipe"],
  });

  writeSyncMeta(cacheDir, branch);
  console.error(`Clone complete → ${cacheDir}`);
  return cacheDir;
}

export async function syncRepo(config: GitCacheConfig): Promise<SyncResult> {
  const { repoUrl, branch, cacheDir } = config;

  if (!isValidCache(cacheDir, repoUrl)) {
    await ensureRepo(config);
    const currentHead = git("rev-parse --short HEAD", cacheDir).trim();
    return { alreadyUpToDate: false, previousHead: "(none)", currentHead, filesChanged: -1,
      summary: `Fresh clone completed. HEAD is now at ${currentHead}.` };
  }

  const previousHead = git("rev-parse --short HEAD", cacheDir).trim();
  console.error(`Fetching latest from origin/${branch}...`);
  git(`fetch origin ${branch}`, cacheDir, { timeout: 300_000 });

  const localHead = git("rev-parse HEAD", cacheDir).trim();
  const remoteHead = git(`rev-parse origin/${branch}`, cacheDir).trim();

  if (localHead === remoteHead) {
    writeSyncMeta(cacheDir, branch);
    return { alreadyUpToDate: true, previousHead, currentHead: previousHead, filesChanged: 0,
      summary: `Already up to date at ${previousHead}.` };
  }

  let diffStat = "";
  let filesChanged = 0;
  try {
    diffStat = git(`diff --stat HEAD..origin/${branch}`, cacheDir);
    const lines = diffStat.trim().split("\n");
    const fileMatch = lines[lines.length - 1].match(/(\d+) files? changed/);
    filesChanged = fileMatch ? parseInt(fileMatch[1], 10) : 0;
  } catch { /**/ }

  git(`reset --hard origin/${branch}`, cacheDir);
  const currentHead = git("rev-parse --short HEAD", cacheDir).trim();
  writeSyncMeta(cacheDir, branch);

  return {
    alreadyUpToDate: false, previousHead, currentHead, filesChanged,
    summary: [`Updated ${previousHead} → ${currentHead}`, `${filesChanged} files changed.`,
      diffStat ? `\n${diffStat}` : ""].join("\n"),
  };
}

export function getSyncStatus(cacheDir: string): { exists: boolean; lastSync?: string; head?: string; branch?: string } {
  const metaPath = join(cacheDir, ".wallet-web-mcp-meta.json");
  if (!existsSync(metaPath)) return { exists: existsSync(join(cacheDir, ".git")) };
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    let head: string | undefined;
    try { head = git("rev-parse --short HEAD", cacheDir).trim(); } catch { /**/ }
    return { exists: true, lastSync: meta.lastSync, head, branch: meta.branch };
  } catch {
    return { exists: existsSync(join(cacheDir, ".git")) };
  }
}

function writeSyncMeta(cacheDir: string, branch: string) {
  const metaPath = join(cacheDir, ".wallet-web-mcp-meta.json");
  try {
    writeFileSync(metaPath, JSON.stringify({ lastSync: new Date().toISOString(), branch }, null, 2));
  } catch { /**/ }
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
