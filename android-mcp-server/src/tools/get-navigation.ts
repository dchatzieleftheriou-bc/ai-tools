/**
 * Tool: get_navigation_flow
 * Traces Compose Navigation: NavHost, NavController, NavigationEvent sealed classes,
 * deep links, and screen composables.
 */
import { z } from "zod";
import { repoPath, listDir, isDirectory, readTextFile, relPath } from "../repo.js";
import { join } from "path";

export const getNavigationSchema = z.object({
  feature: z.string().describe('Feature name, e.g. "earn", "lending", "settings".'),
});

export type GetNavigationInput = z.infer<typeof getNavigationSchema>;

interface NavEntry {
  type: "composable_screen" | "nav_event" | "nav_host" | "nav_controller" | "deep_link" | "route_def";
  description: string;
  file: string;
  line: number;
  snippet: string;
}

function findNavPatterns(content: string, filePath: string): NavEntry[] {
  const entries: NavEntry[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (line.match(/NavHost\s*\(/)) {
      entries.push({ type: "nav_host", description: "NavHost definition", file: filePath, line: lineNum,
        snippet: lines.slice(i, Math.min(i + 3, lines.length)).map((l) => l.trim()).join("\n    ") });
    }

    if (line.match(/composable\s*\(\s*["']/)) {
      entries.push({ type: "route_def", description: "Composable route", file: filePath, line: lineNum,
        snippet: lines.slice(i, Math.min(i + 2, lines.length)).map((l) => l.trim()).join("\n    ") });
    }

    if (line.match(/navController\.\s*navigate\s*\(/)) {
      entries.push({ type: "nav_controller", description: "NavController.navigate()", file: filePath, line: lineNum,
        snippet: line.trim() });
    }

    if (line.match(/NavigationEvent|NavigationAction|Navigation\s*\{/) && line.match(/sealed|interface|class/)) {
      entries.push({ type: "nav_event", description: "Navigation event definition", file: filePath, line: lineNum,
        snippet: lines.slice(i, Math.min(i + 6, lines.length)).map((l) => l.trim()).join("\n    ") });
    }

    if (line.match(/deepLink|deep_link|DeepLink/i) && !line.trim().startsWith("//")) {
      entries.push({ type: "deep_link", description: "Deep link reference", file: filePath, line: lineNum,
        snippet: line.trim() });
    }
  }

  return entries;
}

function findComposableScreens(content: string, filePath: string): { name: string; file: string }[] {
  const screens: { name: string; file: string }[] = [];
  const matches = content.matchAll(/@Composable\s+(?:fun|internal\s+fun|private\s+fun)\s+(\w+Screen|\w+Page|\w+Sheet|\w+Dialog)/g);
  for (const m of matches) {
    screens.push({ name: m[1], file: filePath });
  }
  return screens;
}

async function walkKotlinFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await listDir(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      if (await isDirectory(full)) results.push(...(await walkKotlinFiles(full)));
      else if (entry.endsWith(".kt")) results.push(full);
    }
  } catch { /* */ }
  return results;
}

export async function getNavigation(input: GetNavigationInput): Promise<string> {
  const root = repoPath(".");
  const allDirs = await listDir(root);
  const featureName = input.feature.toLowerCase();

  const candidates: string[] = [];
  for (const dir of allDirs) {
    if (dir.toLowerCase().includes(featureName) && await isDirectory(repoPath(dir))) {
      candidates.push(dir);
      const subs = await listDir(repoPath(dir));
      for (const sub of subs) {
        const subPath = join(dir, sub);
        if (await isDirectory(repoPath(subPath))) {
          candidates.push(subPath);
          const subsubs = await listDir(repoPath(subPath));
          for (const ss of subsubs) {
            if (["domain", "data", "presentation"].includes(ss))
              candidates.push(join(subPath, ss));
          }
        }
      }
    }
  }

  if (candidates.length === 0) {
    return `No module found matching "${input.feature}".`;
  }

  const allEntries: NavEntry[] = [];
  const allScreens: { name: string; file: string }[] = [];

  for (const modulePath of candidates) {
    const srcDir = join(repoPath(modulePath), "src", "main");
    if (!(await isDirectory(srcDir))) continue;

    const files = await walkKotlinFiles(srcDir);
    for (const f of files) {
      const rel = relPath(f);
      if (rel.includes("test") || rel.includes("Test")) continue;
      const content = await readTextFile(f);
      allEntries.push(...findNavPatterns(content, rel));
      allScreens.push(...findComposableScreens(content, rel));
    }
  }

  const output: string[] = [`# Navigation Flow — ${input.feature}`, `Modules: ${candidates.join(", ")}\n`];

  if (allScreens.length > 0) {
    output.push(`## Composable Screens (${allScreens.length})\n`);
    for (const s of allScreens) output.push(`  ${s.name} — ${s.file}`);
  }

  const byType = new Map<string, NavEntry[]>();
  for (const e of allEntries) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type)!.push(e);
  }

  const typeLabels: Record<string, string> = {
    nav_event: "Navigation Event Definitions (sealed classes)",
    nav_host: "NavHost Definitions",
    route_def: "Composable Route Registrations",
    nav_controller: "NavController.navigate() Calls",
    deep_link: "Deep Link References",
  };

  for (const type of ["nav_event", "nav_host", "route_def", "nav_controller", "deep_link"]) {
    const items = byType.get(type);
    if (!items || items.length === 0) continue;
    output.push(`\n## ${typeLabels[type] || type} (${items.length})\n`);
    for (const item of items) {
      output.push(`  ${item.file}:${item.line}`);
      output.push(`    ${item.snippet}`);
      output.push("");
    }
  }

  if (allEntries.length === 0 && allScreens.length === 0) {
    output.push("\nNo navigation patterns found. Try search_code with 'navigate' or 'NavController'.");
  }

  return output.join("\n");
}
