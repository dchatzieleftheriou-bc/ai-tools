/**
 * Tool: list_modules
 * Lists all Android Gradle modules with classification and dependency info.
 * Parses settings.gradle to discover modules and build.gradle for dependencies.
 */
import { z } from "zod";
import { repoPath, readTextFile, fileExists, isDirectory, listDir } from "../repo.js";
import { join } from "path";

export const listModulesSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe(
      "Optional filter — 'feature', 'core', 'common', 'payments', or a substring to match module names."
    ),
});

export type ListModulesInput = z.infer<typeof listModulesSchema>;

interface ModuleInfo {
  name: string;
  type: string;
  layer?: string;
  path: string;
  dependencies: string[];
}

function classifyModule(name: string): { type: string; layer?: string } {
  const parts = name.split(":");
  const last = parts[parts.length - 1];
  const parent = parts.length > 1 ? parts[parts.length - 2] : "";

  // Detect layer
  let layer: string | undefined;
  if (last === "domain") layer = "domain";
  else if (last === "data") layer = "data";
  else if (last === "presentation") layer = "presentation";

  // Classify type
  if (name === "app") return { type: "app" };
  if (["core", "coreandroid", "coincore", "balance", "wallet"].includes(name))
    return { type: "core", layer };
  if (name.startsWith("common")) return { type: "common", layer };
  if (name.startsWith("blockchainApi")) return { type: "api" };
  if (name.startsWith("componentlib")) return { type: "ui" };
  if (name.startsWith("store")) return { type: "storage", layer };
  if (name.startsWith("payments")) return { type: "payments", layer };
  if (name.startsWith("kyc")) return { type: "kyc", layer };
  if (name.startsWith("flow")) return { type: "feature-flow", layer };
  if (["string-resources", "commonarch", "testutils", "testutils-android"].includes(name))
    return { type: "utility" };

  // Anything with domain/data/presentation layers is a feature
  if (layer) return { type: "feature", layer };

  return { type: "feature", layer };
}

function moduleNameToPath(name: string): string {
  return name.replace(/:/g, "/");
}

async function parseBuildGradleDeps(modulePath: string): Promise<string[]> {
  const deps: string[] = [];
  for (const filename of ["build.gradle", "build.gradle.kts"]) {
    const buildPath = join(modulePath, filename);
    if (await fileExists(buildPath)) {
      const content = await readTextFile(buildPath);
      const matches = content.matchAll(/(?:implementation|api)\s*(?:\(?\s*)?project\s*\(\s*["']([^"']+)["']\s*\)/g);
      for (const m of matches) {
        deps.push(m[1]);
      }
    }
  }
  return deps;
}

export async function listModules(input: ListModulesInput): Promise<string> {
  // Parse settings.gradle for module declarations
  let settingsContent = "";
  for (const filename of ["settings.gradle", "settings.gradle.kts"]) {
    const path = repoPath(filename);
    if (await fileExists(path)) {
      settingsContent = await readTextFile(path);
      break;
    }
  }

  const moduleNames: string[] = [];
  // Extract all quoted module names (handles multi-line comma-separated include statements)
  const allQuoted = settingsContent.matchAll(/['"](:[\w:.-]+)['"]/g);
  for (const m of allQuoted) {
    const name = m[1].replace(/^:/, "");
    if (!moduleNames.includes(name)) moduleNames.push(name);
  }

  // Build module info
  const modules: ModuleInfo[] = [];
  for (const name of moduleNames) {
    const { type, layer } = classifyModule(name);
    const path = moduleNameToPath(name);
    const fullPath = repoPath(path);
    const deps = await parseBuildGradleDeps(fullPath);

    modules.push({ name, type, layer, path, dependencies: deps });
  }

  // Apply filter
  let filtered = modules;
  if (input.filter) {
    const f = input.filter.toLowerCase();
    filtered = modules.filter(
      (m) =>
        m.type === f ||
        m.name.toLowerCase().includes(f) ||
        (m.layer && m.layer === f)
    );
  }

  // Sort by type then name
  filtered.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  const output: string[] = [
    `Found ${filtered.length} modules${input.filter ? ` (filter: "${input.filter}")` : ""}:\n`,
  ];

  let currentType = "";
  for (const m of filtered) {
    if (m.type !== currentType) {
      currentType = m.type;
      output.push(`\n## ${currentType.toUpperCase()}`);
    }
    output.push(`\n### :${m.name}${m.layer ? ` [${m.layer}]` : ""}`);
    output.push(`  Path: ${m.path}/`);
    if (m.dependencies.length > 0)
      output.push(`  Dependencies: ${m.dependencies.join(", ")}`);
  }

  return output.join("\n");
}
