import { z } from "zod";
import { repoPath, listDir, isDirectory, readTextFile, fileExists, grepRepo, getRepoRoot } from "../repo.js";
import { join } from "path";

export const getApiEndpointsSchema = z.object({
  filter: z.string().optional().describe("Optional scope filter, e.g. 'lending', 'brokerage'."),
});

export type GetApiEndpointsInput = z.infer<typeof getApiEndpointsSchema>;

async function getGeneratedFetchers(filter?: string): Promise<string> {
  const genDir = repoPath("src", "generated", "openapi");
  if (!(await fileExists(genDir))) return "## Generated API Fetchers (Orval)\n  (src/generated/openapi/ not found)\n";

  const entries = (await listDir(genDir)).filter((e) => e.endsWith(".ts"));
  const lines: string[] = ["## Generated API Fetchers (Orval)\n"];

  for (const entry of entries) {
    if (filter && !entry.toLowerCase().includes(filter.toLowerCase())) continue;
    const content = await readTextFile(join(genDir, entry));
    const fns: string[] = [];
    for (const m of content.matchAll(/^export const (\w+)\s*=/gm)) {
      fns.push(m[1]);
    }
    if (fns.length > 0) {
      lines.push(`### src/generated/openapi/${entry} (${fns.length} exports)`);
      for (const fn of fns.slice(0, 20)) lines.push(`  ${fn}()`);
      if (fns.length > 20) lines.push(`  ... and ${fns.length - 20} more`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function getDirectCalls(filter?: string): Promise<string> {
  const root = getRepoRoot();
  const raw = grepRepo("axios\\.|\\bfetch\\s*\\(", { glob: "*.{ts,tsx}", maxResults: 100 });
  const lines: string[] = ["## Direct axios / fetch Calls\n"];

  for (const line of raw.split("\n").filter(Boolean)) {
    const rel = line.startsWith(root) ? line.substring(root.length + 1) : line;
    if (rel.includes("generated/") || rel.includes("node_modules")) continue;
    if (filter && !rel.toLowerCase().includes(filter.toLowerCase())) continue;
    lines.push(rel);
  }

  if (lines.length === 1) lines.push("  (none found)");
  return lines.join("\n");
}

async function getApiRoutes(filter?: string): Promise<string> {
  const apiDir = repoPath("src", "pages", "api");
  if (!(await fileExists(apiDir))) return "## Next.js API Routes\n  (no src/pages/api/ directory)\n";

  const lines: string[] = ["## Next.js API Routes\n"];

  async function walk(dir: string, prefix: string) {
    for (const e of await listDir(dir)) {
      const full = join(dir, e);
      if (await isDirectory(full)) {
        await walk(full, `${prefix}/${e}`);
      } else if (e.match(/\.(tsx?|js)$/)) {
        const stem = e.replace(/\.(tsx?|js)$/, "");
        const route = stem === "index" ? prefix : `${prefix}/${stem}`;
        if (!filter || route.toLowerCase().includes(filter.toLowerCase())) {
          lines.push(`  /api${route}  →  src/pages/api${prefix}/${e}`);
        }
      }
    }
  }

  await walk(apiDir, "");
  if (lines.length === 1) lines.push("  (none found)");
  return lines.join("\n");
}

export async function getApiEndpoints(input: GetApiEndpointsInput): Promise<string> {
  const [generated, direct, routes] = await Promise.all([
    getGeneratedFetchers(input.filter),
    getDirectCalls(input.filter),
    getApiRoutes(input.filter),
  ]);

  return [`# API Endpoints${input.filter ? ` — ${input.filter}` : ""}\n`, generated, direct, routes].join("\n\n---\n\n");
}
