/**
 * Repository helper utilities — file system operations scoped to the iOS repo.
 */
import { readFile, readdir, stat, access } from "fs/promises";
import { join, relative, basename, dirname } from "path";
import { execSync } from "child_process";

let REPO_ROOT: string;

export function setRepoRoot(root: string) {
  REPO_ROOT = root;
}

export function getRepoRoot(): string {
  if (!REPO_ROOT) {
    throw new Error(
      "Repo root not set. Pass --repo-root <path> or set WALLET_IOS_REPO env var."
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

/**
 * Run ripgrep (rg) or fall back to grep. Returns matching lines.
 */
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

  // Try rg first, fall back to grep
  const useRg = commandExists("rg");
  const cmd = useRg ? "rg" : "grep";

  if (useRg) {
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
    if (fileGlob) {
      args.push(`--include=${fileGlob}`);
    }
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
    // grep returns exit code 1 when no matches found
    if (e.status === 1) return "";
    throw e;
  }
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
