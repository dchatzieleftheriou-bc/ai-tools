import { z } from "zod";
import { repoPath, listDir, isDirectory, readTextFile, fileExists } from "../repo.js";
import { join } from "path";

export const getRoutesSchema = z.object({
  filter: z.string().optional().describe("Optional URL path or kind filter, e.g. 'account', 'api', 'dynamic'."),
});

export type GetRoutesInput = z.infer<typeof getRoutesSchema>;

type RouteKind = "static" | "dynamic" | "catch-all" | "api" | "special";

interface Route {
  url: string;
  file: string;
  kind: RouteKind;
}

function segToUrlPart(seg: string): string {
  return seg.replace(/\[\.\.\.(\w+)\]/, "*").replace(/\[(\w+)\]/, ":$1");
}

function fileKind(stem: string, isUnderApi: boolean): RouteKind {
  if (isUnderApi) return "api";
  if (stem.startsWith("_")) return "special";
  if (stem.startsWith("[...")) return "catch-all";
  if (stem.startsWith("[")) return "dynamic";
  return "static";
}

async function walkPages(dir: string, urlParts: string[], relParts: string[]): Promise<Route[]> {
  const routes: Route[] = [];
  const isUnderApi = relParts[0] === "api";

  for (const entry of await listDir(dir)) {
    const full = join(dir, entry);
    const stem = entry.replace(/\.(tsx?|js)$/, "");

    if (await isDirectory(full)) {
      routes.push(...(await walkPages(full, [...urlParts, segToUrlPart(entry)], [...relParts, entry])));
    } else if (entry.match(/\.(tsx?|js)$/)) {
      const kind = fileKind(stem, isUnderApi);
      const relFile = `src/pages/${[...relParts, entry].join("/")}`;

      if (stem === "index") {
        const url = "/" + urlParts.join("/");
        routes.push({ url: url || "/", file: relFile, kind });
      } else {
        const urlFull = "/" + [...urlParts, segToUrlPart(stem)].join("/");
        routes.push({ url: urlFull, file: relFile, kind });
      }
    }
  }
  return routes;
}

async function getMiddlewareInfo(): Promise<string> {
  const mwPath = repoPath("src", "middleware.ts");
  if (!(await fileExists(mwPath))) return "";
  const content = await readTextFile(mwPath);
  const matcherMatch = content.match(/matcher\s*:\s*(\[[\s\S]*?\])/);
  const matcher = matcherMatch ? matcherMatch[1].replace(/\s+/g, " ") : "(no matcher config found)";
  return `\n## Middleware (src/middleware.ts)\nMatcher: ${matcher}\n`;
}

export async function getRoutes(input: GetRoutesInput): Promise<string> {
  const pagesDir = repoPath("src", "pages");

  if (!(await fileExists(pagesDir))) {
    return "# Next.js Routes\n  (src/pages/ not found — is this a Pages Router project? App Router is not yet supported.)";
  }

  const allRoutes = await walkPages(pagesDir, [], []);

  let filtered = allRoutes;
  if (input.filter) {
    const f = input.filter.toLowerCase();
    filtered = allRoutes.filter((r) => r.url.toLowerCase().includes(f) || r.kind === f);
  }

  filtered.sort((a, b) => a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url));

  const out: string[] = [
    `# Next.js Routes${input.filter ? ` — ${input.filter}` : ""}`,
    `Total: ${filtered.length} routes\n`,
  ];

  const byKind = new Map<RouteKind, Route[]>();
  for (const r of filtered) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind)!.push(r);
  }

  const kindLabels: Record<RouteKind, string> = {
    static: "Static Routes",
    dynamic: "Dynamic Routes",
    "catch-all": "Catch-all Routes",
    api: "API Routes",
    special: "Special Files (_app, _document)",
  };

  for (const kind of ["static", "dynamic", "catch-all", "api", "special"] as RouteKind[]) {
    const items = byKind.get(kind);
    if (!items || items.length === 0) continue;
    out.push(`\n## ${kindLabels[kind]} (${items.length})\n`);
    for (const r of items) {
      out.push(`  ${r.url}`);
      out.push(`    → ${r.file}`);
    }
  }

  out.push(await getMiddlewareInfo());
  return out.join("\n");
}
