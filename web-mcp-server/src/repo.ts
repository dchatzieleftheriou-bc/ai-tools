import { readFile, readdir, stat, access } from "fs/promises";
import { join, relative } from "path";
import { execSync } from "child_process";

const USE_RG = (() => { try { execSync("which rg", { encoding: "utf-8", stdio: "pipe" }); return true; } catch { return false; } })();

let REPO_ROOT: string;

export function setRepoRoot(root: string) {
  REPO_ROOT = root;
}

export function getRepoRoot(): string {
  if (!REPO_ROOT) {
    throw new Error(
      "Repo root not set. Pass --repo-root <path> or set WALLET_WEB_REPO env var."
    );
  }
  return REPO_ROOT;
}

export function repoPath(...segments: string[]): string {
  return join(getRepoRoot(), ...segments);
}

export function relPath(absPath: string): string {
  return relative(getRepoRoot(), absPath);
}

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function walkFiles(dir: string, extensions: string[]): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      if ((await stat(full)).isDirectory()) {
        results.push(...(await walkFiles(full, extensions)));
      } else if (extensions.some((ext) => entry.endsWith(ext))) {
        results.push(full);
      }
    }
  } catch { /**/ }
  return results;
}

export function grepRepo(
  pattern: string,
  opts: {
    glob?: string;
    maxResults?: number;
    contextLines?: number;
    caseSensitive?: boolean;
    filesOnly?: boolean;
  } = {}
): string {
  const {
    glob: fileGlob,
    maxResults = 200,
    contextLines = 0,
    caseSensitive = false,
    filesOnly = false,
  } = opts;

  const args: string[] = [];
  const cmd = USE_RG ? "rg" : "grep";

  if (USE_RG) {
    if (!caseSensitive) args.push("-i");
    if (filesOnly) args.push("-l");
    else args.push("-n");
    if (contextLines > 0) args.push(`-C${contextLines}`);
    if (fileGlob) args.push(`--glob=${fileGlob}`);
    args.push(`--max-count=${maxResults}`);
    args.push("--no-heading");
    args.push("--");
    args.push(pattern);
    args.push(getRepoRoot());
  } else {
    if (!caseSensitive) args.push("-i");
    if (filesOnly) args.push("-l");
    else args.push("-n");
    if (contextLines > 0) args.push(`-C${contextLines}`);
    args.push("-r");
    if (fileGlob) args.push(`--include=${fileGlob}`);
    args.push("--");
    args.push(pattern);
    args.push(getRepoRoot());
  }

  try {
    const result = execSync(`${cmd} ${args.map(shellEscape).join(" ")}`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    });
    return result;
  } catch (e: any) {
    if (e.status === 1) return "";
    throw e;
  }
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
