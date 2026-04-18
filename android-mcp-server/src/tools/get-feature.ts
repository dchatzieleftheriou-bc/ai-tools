/**
 * Tool: get_feature
 * Deep-dive into an Android feature module — extracts ViewModels, state/intent models,
 * Composable screens, API calls, repositories, DI modules, and navigation.
 */
import { z } from "zod";
import {
  repoPath, listDir, isDirectory, readTextFile, fileExists, relPath,
} from "../repo.js";
import { join } from "path";

export const getFeatureSchema = z.object({
  feature: z
    .string()
    .describe('Feature name, e.g. "earn", "lending", "dex", "kyc-providers". Searches matching module directories.'),
  include_source: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, include full source code of key files (ViewModels, models). Default: false."),
});

export type GetFeatureInput = z.infer<typeof getFeatureSchema>;

interface FeatureFile {
  relativePath: string;
  category: "viewmodel" | "state" | "intent" | "model" | "screen" | "api" | "repository" | "di" | "navigation" | "test" | "other";
  summary: string;
}

function categorizeFile(filename: string, content: string): FeatureFile["category"] {
  const lower = filename.toLowerCase();
  if (lower.includes("viewmodel")) return "viewmodel";
  if (lower.includes("intent") || lower.includes("event")) return "intent";
  if (lower.includes("state") && !lower.includes("test")) return "state";
  if (lower.includes("screen") || lower.includes("page") || lower.includes("composable")) return "screen";
  if (lower.includes("repository") || lower.includes("service")) return "repository";
  if (lower.includes("api") || lower.includes("interface") || lower.includes("dto")) return "api";
  if (lower.includes("module") && lower.includes("koin") || lower.includes("di")) return "di";
  if (lower.includes("koin")) return "di";
  if (lower.includes("navigation") || lower.includes("navigator")) return "navigation";
  if (lower.includes("test")) return "test";
  if (lower.includes("model") || lower.includes("entity")) return "model";

  // Content-based
  if (content.includes("MviViewModel") || content.includes("ViewModel()")) return "viewmodel";
  if (content.includes("@Composable")) return "screen";
  if (content.includes("@GET") || content.includes("@POST") || content.includes("Retrofit")) return "api";
  if (content.includes("module {") || content.includes("viewModel {")) return "di";
  if (content.includes("NavHost") || content.includes("NavController") || content.includes("NavigationEvent")) return "navigation";
  if (content.includes("@Serializable") || content.includes("data class")) return "model";
  if (content.includes("interface") && content.includes("Repository")) return "repository";

  return "other";
}

function summarizeKotlinFile(content: string): string {
  const lines = content.split("\n");
  const classes = lines.filter((l) => l.match(/^\s*(data\s+)?class\s+\w+/)).map((l) => l.trim()).slice(0, 5);
  const interfaces = lines.filter((l) => l.match(/^\s*interface\s+\w+/)).map((l) => l.trim()).slice(0, 5);
  const objects = lines.filter((l) => l.match(/^\s*(sealed\s+)?(?:object|enum\s+class)\s+\w+/)).map((l) => l.trim()).slice(0, 5);
  const funcs = lines.filter((l) => l.match(/^\s*(?:suspend\s+)?fun\s+\w+/)).map((l) => l.trim()).slice(0, 8);

  const parts: string[] = [];
  if (classes.length) parts.push(`Classes: ${classes.join("; ")}`);
  if (interfaces.length) parts.push(`Interfaces: ${interfaces.join("; ")}`);
  if (objects.length) parts.push(`Objects/Enums: ${objects.join("; ")}`);
  if (funcs.length) parts.push(`Functions: ${funcs.join("; ")}`);

  return parts.join("\n    ") || "(empty or non-standard structure)";
}

async function walkKotlinFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await listDir(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      if (await isDirectory(full)) {
        results.push(...(await walkKotlinFiles(full)));
      } else if (entry.endsWith(".kt") || entry.endsWith(".java")) {
        results.push(full);
      }
    }
  } catch { /* dir doesn't exist */ }
  return results;
}

export async function getFeature(input: GetFeatureInput): Promise<string> {
  const root = repoPath(".");
  const allDirs = await listDir(root);

  const featureName = input.feature.toLowerCase();

  // Find matching module directories (could be top-level or nested)
  const candidates: string[] = [];
  for (const dir of allDirs) {
    if (dir.toLowerCase().includes(featureName) && await isDirectory(repoPath(dir))) {
      candidates.push(dir);
    }
  }

  // Also check for nested modules (e.g., kyc-providers/prove/presentation)
  for (const candidate of [...candidates]) {
    const subDirs = await listDir(repoPath(candidate));
    for (const sub of subDirs) {
      const subPath = join(candidate, sub);
      if (await isDirectory(repoPath(subPath)) && ["domain", "data", "presentation"].includes(sub)) {
        if (!candidates.includes(subPath)) candidates.push(subPath);
      }
      // Nested features (e.g., kyc-providers/prove)
      if (await isDirectory(repoPath(subPath))) {
        const subSubDirs = await listDir(repoPath(subPath));
        for (const subsub of subSubDirs) {
          if (["domain", "data", "presentation"].includes(subsub)) {
            const deepPath = join(subPath, subsub);
            if (!candidates.includes(deepPath)) candidates.push(deepPath);
          }
        }
      }
    }
  }

  if (candidates.length === 0) {
    return `No module found matching "${input.feature}". Use list_modules to see available modules.`;
  }

  const output: string[] = [`# Feature: ${input.feature}`, `Matched directories: ${candidates.join(", ")}\n`];

  for (const modulePath of candidates) {
    const srcDir = join(repoPath(modulePath), "src", "main");
    if (!(await isDirectory(srcDir))) continue;

    output.push(`\n## Module: ${modulePath}`);

    const kotlinFiles = await walkKotlinFiles(srcDir);
    const categorized: Record<string, FeatureFile[]> = {};

    for (const filePath of kotlinFiles) {
      const content = await readTextFile(filePath);
      const category = categorizeFile(filePath.split("/").pop() || "", content);
      const rel = relPath(filePath);
      const summary = summarizeKotlinFile(content);

      if (!categorized[category]) categorized[category] = [];
      categorized[category].push({ relativePath: rel, category, summary });
    }

    const categoryOrder: FeatureFile["category"][] = [
      "viewmodel", "state", "intent", "model", "api", "repository", "screen", "di", "navigation", "test", "other",
    ];

    for (const cat of categoryOrder) {
      const files = categorized[cat];
      if (!files || files.length === 0) continue;
      output.push(`\n### ${cat.toUpperCase()} (${files.length} files)`);
      for (const f of files) {
        output.push(`\n  📄 ${f.relativePath}`);
        output.push(`    ${f.summary}`);
      }
    }

    if (input.include_source) {
      output.push(`\n### KEY FILE SOURCES`);
      for (const cat of ["viewmodel", "state", "intent", "model", "api"] as const) {
        const files = categorized[cat];
        if (!files) continue;
        for (const f of files.slice(0, 3)) {
          const content = await readTextFile(repoPath(f.relativePath));
          output.push(`\n--- ${f.relativePath} (${cat}) ---`);
          output.push("```kotlin");
          output.push(content.slice(0, 5000));
          if (content.length > 5000) output.push("\n// ... truncated ...");
          output.push("```");
        }
      }
    }
  }

  return output.join("\n");
}
