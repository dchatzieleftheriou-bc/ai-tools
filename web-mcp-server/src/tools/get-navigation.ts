import { z } from "zod";
import { repoPath, listDir, isDirectory, readTextFile, relPath, walkFiles } from "../repo.js";
import { join } from "path";

export const getNavigationSchema = z.object({
  feature: z.string().describe('Feature or page name, e.g. "lending", "settings".'),
});

export type GetNavigationInput = z.infer<typeof getNavigationSchema>;

type NavType = "screen" | "link" | "router-push" | "router-replace" | "redirect" | "dynamic-param";

interface NavEntry {
  type: NavType;
  file: string;
  line: number;
  snippet: string;
}

function findNavPatterns(content: string, filePath: string): NavEntry[] {
  const entries: NavEntry[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/<Link\s/)) {
      entries.push({ type: "link", file: filePath, line: i + 1, snippet: line.trim().substring(0, 120) });
    }

    if (line.match(/router\.(push|replace)\s*\(/)) {
      const type: NavType = line.includes(".push") ? "router-push" : "router-replace";
      entries.push({ type, file: filePath, line: i + 1, snippet: line.trim().substring(0, 120) });
    }

    if (line.match(/\bredirect\s*\(|\bnotFound\s*\(/)) {
      entries.push({ type: "redirect", file: filePath, line: i + 1, snippet: line.trim() });
    }
  }

  return entries;
}

function findScreenComponents(content: string): string[] {
  const screens: string[] = [];
  for (const m of content.matchAll(/^(?:export default function|export function|const) (\w+(?:Page|Screen|View|Layout))\b/gm)) {
    screens.push(m[1]);
  }
  return screens;
}

function extractDynamicParams(filePath: string): string[] {
  const params: string[] = [];
  for (const m of filePath.matchAll(/\[\.\.\.(\w+)\]|\[(\w+)\]/g)) {
    params.push(m[1] || m[2]);
  }
  return params;
}


export async function getNavigation(input: GetNavigationInput): Promise<string> {
  const f = input.feature.toLowerCase();
  const searchBases = [repoPath("src", "pages"), repoPath("src", "components"), repoPath("src", "features")];

  const matchedFiles: string[] = [];
  for (const base of searchBases) {
    for (const e of await listDir(base)) {
      if (e.toLowerCase().includes(f)) {
        const full = join(base, e);
        if (await isDirectory(full)) matchedFiles.push(...(await walkFiles(full, [".ts", ".tsx"])));
        else if (e.endsWith(".tsx") || e.endsWith(".ts")) matchedFiles.push(full);
      }
    }
  }

  if (matchedFiles.length === 0) {
    return `No files found matching "${input.feature}". Try list_modules to see available pages.`;
  }

  const allEntries: NavEntry[] = [];
  const allScreens: { name: string; file: string }[] = [];
  const allDynamicParams: { param: string; file: string }[] = [];

  for (const file of matchedFiles) {
    const rel = relPath(file);
    const content = await readTextFile(file);
    allEntries.push(...findNavPatterns(content, rel));
    for (const s of findScreenComponents(content)) allScreens.push({ name: s, file: rel });
    for (const p of extractDynamicParams(rel)) allDynamicParams.push({ param: p, file: rel });
  }

  const out: string[] = [`# Navigation Flow — ${input.feature}\n`];

  if (allScreens.length > 0) {
    out.push(`## Screen / Page Components (${allScreens.length})\n`);
    for (const s of allScreens) out.push(`  ${s.name} — ${s.file}`);
    out.push("");
  }

  if (allDynamicParams.length > 0) {
    out.push(`## Dynamic Route Parameters\n`);
    for (const p of allDynamicParams) out.push(`  [${p.param}] — ${p.file}`);
    out.push("");
  }

  const byType = new Map<NavType, NavEntry[]>();
  for (const e of allEntries) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type)!.push(e);
  }

  const labels: Partial<Record<NavType, string>> = {
    link: "Link Components",
    "router-push": "router.push() Calls",
    "router-replace": "router.replace() Calls",
    redirect: "redirect() / notFound() Calls",
  };

  for (const type of ["link", "router-push", "router-replace", "redirect"] as NavType[]) {
    const items = byType.get(type);
    if (!items || items.length === 0) continue;
    out.push(`\n## ${labels[type]} (${items.length})\n`);
    for (const e of items) {
      out.push(`  ${e.file}:${e.line}`);
      out.push(`    ${e.snippet}`);
      out.push("");
    }
  }

  if (allEntries.length === 0 && allScreens.length === 0) {
    out.push("No navigation patterns found. Try search_code with 'router.push' or '<Link'.");
  }

  return out.join("\n");
}
