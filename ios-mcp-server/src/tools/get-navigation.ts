/**
 * Tool: get_navigation_flow
 * Traces how screens connect within a feature — finds navigation actions,
 * route/path definitions, presented sheets, pushed views, and deep links.
 */
import { z } from "zod";
import {
  repoPath,
  listDir,
  isDirectory,
  readTextFile,
  relPath,
  grepRepo,
  getRepoRoot,
} from "../repo.js";
import { join } from "path";

export const getNavigationSchema = z.object({
  feature: z
    .string()
    .describe(
      'Feature name, e.g. "Transaction", "KYC", "Authentication".'
    ),
});

export type GetNavigationInput = z.infer<typeof getNavigationSchema>;

interface NavigationEntry {
  type: "push" | "sheet" | "fullscreen" | "deeplink" | "route" | "action" | "destination";
  description: string;
  file: string;
  line: number;
  snippet: string;
}

function findNavigationPatterns(
  content: string,
  filePath: string
): NavigationEntry[] {
  const entries: NavigationEntry[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // NavigationLink
    if (line.match(/NavigationLink/)) {
      entries.push({
        type: "push",
        description: "NavigationLink",
        file: filePath,
        line: lineNum,
        snippet: line.trim(),
      });
    }

    // .navigationDestination
    if (line.match(/\.navigationDestination/)) {
      entries.push({
        type: "destination",
        description: "Navigation destination handler",
        file: filePath,
        line: lineNum,
        snippet: getSnippet(lines, i, 3),
      });
    }

    // .sheet / .fullScreenCover
    if (line.match(/\.sheet\s*\(/)) {
      entries.push({
        type: "sheet",
        description: "Sheet presentation",
        file: filePath,
        line: lineNum,
        snippet: getSnippet(lines, i, 2),
      });
    }
    if (line.match(/\.fullScreenCover\s*\(/)) {
      entries.push({
        type: "fullscreen",
        description: "Full screen cover",
        file: filePath,
        line: lineNum,
        snippet: getSnippet(lines, i, 2),
      });
    }

    // Deep link / URL routing
    if (line.match(/blockchain\.ux\.[a-z._]+/) && line.match(/\.then\.navigate|\.then\.enter|\.paragraph\.then/)) {
      entries.push({
        type: "deeplink",
        description: "Namespace navigation event",
        file: filePath,
        line: lineNum,
        snippet: line.trim(),
      });
    }

    // app.post(event:) navigation events
    if (line.match(/app\.post\s*\(\s*event:/)) {
      entries.push({
        type: "action",
        description: "App event post (potential navigation trigger)",
        file: filePath,
        line: lineNum,
        snippet: line.trim(),
      });
    }

    // Router / Coordinator patterns
    if (line.match(/\.route\s*\(|router\.|Router\.|coordinator\./i)) {
      entries.push({
        type: "route",
        description: "Router/coordinator call",
        file: filePath,
        line: lineNum,
        snippet: line.trim(),
      });
    }

    // TCA navigation — Destination reducer / path
    if (line.match(/\.ifLet\s*\(\s*\\\.destination|Destination\.State|Destination\.Action|\.path\s*\(/)) {
      entries.push({
        type: "destination",
        description: "TCA navigation destination",
        file: filePath,
        line: lineNum,
        snippet: getSnippet(lines, i, 2),
      });
    }

    // Present / dismiss
    if (line.match(/\.present\s*\(|\.dismiss\s*\(/)) {
      entries.push({
        type: "action",
        description: "Present/dismiss action",
        file: filePath,
        line: lineNum,
        snippet: line.trim(),
      });
    }
  }

  return entries;
}

/** Find TCA Destination enums — these define the screens a feature can navigate to. */
function findDestinationEnums(content: string, filePath: string): string[] {
  const results: string[] = [];
  const destMatch = content.match(
    /@Reducer\s+(?:public\s+)?enum\s+Destination\s*\{[\s\S]*?\n\s*\}/g
  );
  if (destMatch) {
    for (const block of destMatch) {
      results.push(`${filePath}:\n${block}`);
    }
  }

  // Also look for Destination.State enum inside a reducer
  const stateDestMatch = content.match(
    /enum\s+Destination\s*(?::\s*\w+\s*)?\{[\s\S]*?\n\s{4}\}/g
  );
  if (stateDestMatch) {
    for (const block of stateDestMatch) {
      if (!results.some((r) => r.includes(block))) {
        results.push(`${filePath}:\n${block}`);
      }
    }
  }

  return results;
}

function getSnippet(lines: string[], idx: number, extra: number): string {
  return lines
    .slice(idx, Math.min(idx + extra + 1, lines.length))
    .map((l) => l.trim())
    .join("\n    ");
}

async function walkSwiftFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await listDir(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    if (await isDirectory(full)) {
      results.push(...(await walkSwiftFiles(full)));
    } else if (entry.endsWith(".swift")) {
      results.push(full);
    }
  }
  return results;
}

export async function getNavigation(input: GetNavigationInput): Promise<string> {
  const modulesDir = repoPath("Modules");
  const entries = await listDir(modulesDir);
  const featureName = input.feature.replace(/^Feature/i, "");

  const candidates = entries.filter((e) => {
    const lower = e.toLowerCase();
    return (
      lower.includes(featureName.toLowerCase()) &&
      (lower.startsWith("feature") || lower === featureName.toLowerCase())
    );
  });

  if (candidates.length === 0) {
    return `No module found matching "${input.feature}". Use list_modules to see available modules.`;
  }

  const allEntries: NavigationEntry[] = [];
  const destinationEnums: string[] = [];
  const viewFiles: { file: string; viewNames: string[] }[] = [];

  for (const moduleName of candidates) {
    const sourcesDir = join(modulesDir, moduleName, "Sources");
    if (!(await isDirectory(sourcesDir))) continue;

    const swiftFiles = await walkSwiftFiles(sourcesDir);

    for (const filePath of swiftFiles) {
      const rel = relPath(filePath);
      if (rel.toLowerCase().includes("mock") || rel.toLowerCase().includes("test")) continue;

      const content = await readTextFile(filePath);

      // Find navigation patterns
      const navEntries = findNavigationPatterns(content, rel);
      allEntries.push(...navEntries);

      // Find destination enums
      const destEnums = findDestinationEnums(content, rel);
      destinationEnums.push(...destEnums);

      // Find View structs (to map the screen inventory)
      const viewMatches = [
        ...content.matchAll(
          /(?:public\s+)?struct\s+(\w+)\s*:\s*(?:\w+,\s*)*View\b/g
        ),
      ];
      if (viewMatches.length > 0) {
        viewFiles.push({
          file: rel,
          viewNames: viewMatches.map((m) => m[1]),
        });
      }
    }
  }

  // Build output
  const output: string[] = [
    `# Navigation Flow — ${input.feature}`,
    `Modules: ${candidates.join(", ")}\n`,
  ];

  // Screen inventory
  if (viewFiles.length > 0) {
    output.push(`## Screens (${viewFiles.reduce((n, v) => n + v.viewNames.length, 0)} views)\n`);
    for (const vf of viewFiles) {
      for (const name of vf.viewNames) {
        output.push(`  ${name} — ${vf.file}`);
      }
    }
  }

  // TCA Destinations
  if (destinationEnums.length > 0) {
    output.push(`\n## TCA Navigation Destinations (${destinationEnums.length})\n`);
    output.push(
      "These enums define which screens a reducer can navigate to:\n"
    );
    for (const de of destinationEnums) {
      output.push("```swift");
      output.push(de);
      output.push("```\n");
    }
  }

  // Navigation entries by type
  const byType = new Map<string, NavigationEntry[]>();
  for (const e of allEntries) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type)!.push(e);
  }

  const typeLabels: Record<string, string> = {
    push: "Push Navigation (NavigationLink)",
    destination: "Navigation Destinations",
    sheet: "Sheet Presentations",
    fullscreen: "Full Screen Covers",
    deeplink: "Deep Links / Namespace Navigation",
    route: "Router / Coordinator Calls",
    action: "Navigation Actions (events, present/dismiss)",
  };

  const typeOrder = ["destination", "push", "sheet", "fullscreen", "deeplink", "route", "action"];

  for (const type of typeOrder) {
    const items = byType.get(type);
    if (!items || items.length === 0) continue;

    output.push(`\n## ${typeLabels[type] || type} (${items.length})\n`);
    for (const item of items) {
      output.push(`  ${item.file}:${item.line}`);
      output.push(`    ${item.snippet}`);
      output.push("");
    }
  }

  if (allEntries.length === 0 && viewFiles.length === 0) {
    output.push(
      "\nNo navigation patterns found. The feature may use a custom routing mechanism — try search_code with patterns like 'navigate', 'route', or 'present'."
    );
  }

  return output.join("\n");
}
