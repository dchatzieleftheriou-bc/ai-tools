import { z } from "zod";
import { repoPath, listDir, isDirectory, fileExists } from "../repo.js";
import { join } from "path";

export const listModulesSchema = z.object({
  filter: z.string().optional().describe(
    "Optional filter — 'page', 'feature', 'component-group', 'hook-group', or a name substring."
  ),
});

export type ListModulesInput = z.infer<typeof listModulesSchema>;

type RouteKind = "static" | "dynamic" | "catch-all" | "api" | "special";

interface ModuleInfo {
  name: string;
  type: "page" | "feature" | "component-group" | "hook-group";
  path: string;
  routeKind?: RouteKind;
}

function segmentKind(seg: string): RouteKind {
  if (seg.startsWith("_")) return "special";
  if (seg.startsWith("[...")) return "catch-all";
  if (seg.startsWith("[")) return "dynamic";
  return "static";
}

async function walkPages(dir: string, urlParts: string[], relParts: string[]): Promise<ModuleInfo[]> {
  const results: ModuleInfo[] = [];
  const entries = await listDir(dir);

  for (const entry of entries) {
    const full = join(dir, entry);
    const isDir = await isDirectory(full);
    const stem = entry.replace(/\.(tsx?|js)$/, "");

    if (isDir) {
      results.push(...(await walkPages(full, [...urlParts, entry], [...relParts, entry])));
    } else if (entry.match(/\.(tsx?|js)$/)) {
      const isApi = relParts[0] === "api" || relParts.includes("api");
      if (entry.startsWith("_")) {
        results.push({
          name: `(${stem})`, type: "page",
          path: `src/pages/${[...relParts, entry].join("/")}`, routeKind: "special",
        });
        continue;
      }
      const urlName = stem === "index"
        ? ("/" + urlParts.join("/")) || "/"
        : "/" + [...urlParts, stem].join("/");
      const routeKind: RouteKind = isApi ? "api" : segmentKind(stem);
      results.push({ name: urlName, type: "page", path: `src/pages/${[...relParts, entry].join("/")}`, routeKind });
    }
  }
  return results;
}

async function listTopLevel(srcSubDir: string, type: ModuleInfo["type"]): Promise<ModuleInfo[]> {
  const results: ModuleInfo[] = [];
  const dir = repoPath("src", srcSubDir);
  const entries = await listDir(dir);
  for (const entry of entries) {
    if (await isDirectory(join(dir, entry))) {
      results.push({ name: entry, type, path: `src/${srcSubDir}/${entry}` });
    }
  }
  return results;
}

export async function listModules(input: ListModulesInput): Promise<string> {
  const pagesDir = repoPath("src", "pages");
  const pagesExist = await fileExists(pagesDir);

  const pages = pagesExist ? await walkPages(pagesDir, [], []) : [];
  const features = await listTopLevel("features", "feature");
  const components = await listTopLevel("components", "component-group");
  const hooks = await listTopLevel("hooks", "hook-group");

  let all: ModuleInfo[] = [...pages, ...features, ...components, ...hooks];

  if (input.filter) {
    const f = input.filter.toLowerCase();
    all = all.filter(
      (m) => m.type === f || m.name.toLowerCase().includes(f) || m.routeKind === f
    );
  }

  all.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  const output: string[] = [
    `Found ${all.length} modules${input.filter ? ` (filter: "${input.filter}")` : ""}:\n`,
  ];

  let currentType = "";
  for (const m of all) {
    if (m.type !== currentType) {
      currentType = m.type;
      output.push(`\n## ${currentType.toUpperCase()}`);
    }
    const tag = m.routeKind ? ` [${m.routeKind}]` : "";
    output.push(`\n### ${m.name}${tag}`);
    output.push(`  Path: ${m.path}`);
  }

  return output.join("\n");
}
