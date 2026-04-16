/**
 * Tool: list_modules
 * Lists all iOS modules with their type classification and brief description.
 */
import { z } from "zod";
import { repoPath, listDir, isDirectory, readTextFile, fileExists } from "../repo.js";
import { join } from "path";

export const listModulesSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe(
      "Optional filter — 'feature', 'platform', 'core', or a substring to match module names."
    ),
});

export type ListModulesInput = z.infer<typeof listModulesSchema>;

interface ModuleInfo {
  name: string;
  type: string;
  products: string[];
  internalDependencies: string[];
  externalDependencies: string[];
  path: string;
}

function classifyModule(name: string): string {
  if (name.startsWith("Feature")) return "feature";
  if (name.startsWith("Platform")) return "platform";
  if (name.startsWith("Blockchain")) return "core";
  if (["Network", "NetworkKit"].includes(name)) return "networking";
  if (["UIComponents", "BlockchainComponentLibrary"].includes(name)) return "ui";
  if (["WalletPayload", "WalletCore", "Coincore"].includes(name)) return "wallet";
  if (["Analytics", "AnalyticsKit"].includes(name)) return "analytics";
  if (["Tool", "Extensions", "Errors", "Localization"].includes(name)) return "utility";
  return "other";
}

async function parsePackageSwift(
  packagePath: string
): Promise<{ products: string[]; internalDeps: string[]; externalDeps: string[] }> {
  const content = await readTextFile(packagePath);

  // Extract product names
  const products: string[] = [];
  const productMatches = content.matchAll(/\.library\(\s*name:\s*"([^"]+)"/g);
  for (const m of productMatches) products.push(m[1]);

  // Extract dependencies
  const internalDeps: string[] = [];
  const externalDeps: string[] = [];
  const depLines = content.matchAll(/\.package\((.*?)\)/gs);
  for (const m of depLines) {
    const line = m[1];
    if (line.includes("path:")) {
      const pathMatch = line.match(/path:\s*"([^"]+)"/);
      if (pathMatch) {
        const depName = pathMatch[1].split("/").pop() || pathMatch[1];
        internalDeps.push(depName);
      }
    } else if (line.includes("url:")) {
      const urlMatch = line.match(/url:\s*"([^"]+)"/);
      if (urlMatch) {
        const repoName = urlMatch[1].split("/").pop()?.replace(".git", "") || urlMatch[1];
        externalDeps.push(repoName);
      }
    }
  }

  return { products, internalDeps, externalDeps };
}

export async function listModules(input: ListModulesInput): Promise<string> {
  const modulesDir = repoPath("Modules");
  const entries = await listDir(modulesDir);
  const modules: ModuleInfo[] = [];

  for (const entry of entries) {
    const entryPath = join(modulesDir, entry);
    if (!(await isDirectory(entryPath))) continue;

    const pkgPath = join(entryPath, "Package.swift");
    if (!(await fileExists(pkgPath))) continue;

    const moduleType = classifyModule(entry);
    const { products, internalDeps, externalDeps } = await parsePackageSwift(pkgPath);

    modules.push({
      name: entry,
      type: moduleType,
      products,
      internalDependencies: internalDeps,
      externalDependencies: externalDeps,
      path: `Modules/${entry}`,
    });
  }

  // Apply filter
  let filtered = modules;
  if (input.filter) {
    const f = input.filter.toLowerCase();
    filtered = modules.filter(
      (m) =>
        m.type === f ||
        m.name.toLowerCase().includes(f) ||
        m.products.some((p) => p.toLowerCase().includes(f))
    );
  }

  // Sort by type then name
  filtered.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  // Format output
  const lines: string[] = [`Found ${filtered.length} modules${input.filter ? ` (filter: "${input.filter}")` : ""}:\n`];

  let currentType = "";
  for (const m of filtered) {
    if (m.type !== currentType) {
      currentType = m.type;
      lines.push(`\n## ${currentType.toUpperCase()}`);
    }
    lines.push(`\n### ${m.name}`);
    lines.push(`  Path: ${m.path}`);
    if (m.products.length > 0) lines.push(`  Products: ${m.products.join(", ")}`);
    if (m.internalDependencies.length > 0)
      lines.push(`  Internal deps: ${m.internalDependencies.join(", ")}`);
    if (m.externalDependencies.length > 0)
      lines.push(`  External deps: ${m.externalDependencies.join(", ")}`);
  }

  return lines.join("\n");
}
