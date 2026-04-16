/**
 * Tool: get_feature
 * Deep-dive into a specific feature module — extracts reducers, state models,
 * actions, API calls, domain models, and navigation flow.
 */
import { z } from "zod";
import {
  repoPath,
  listDir,
  isDirectory,
  readTextFile,
  fileExists,
  relPath,
} from "../repo.js";
import { join } from "path";

export const getFeatureSchema = z.object({
  feature: z
    .string()
    .describe(
      'Feature name, e.g. "Authentication", "Transaction", "KYC". Will search for Feature{name} module.'
    ),
  include_source: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, include full source code of key files (reducers, models). Default: false."),
});

export type GetFeatureInput = z.infer<typeof getFeatureSchema>;

interface FeatureFile {
  relativePath: string;
  category: "reducer" | "state" | "action" | "model" | "view" | "api" | "repository" | "mock" | "test" | "other";
  summary: string;
}

function categorizeFile(filename: string, content: string): FeatureFile["category"] {
  const lower = filename.toLowerCase();
  if (lower.includes("reducer")) return "reducer";
  if (lower.includes("state") && !lower.includes("test")) return "state";
  if (lower.includes("action")) return "action";
  if (lower.includes("view") || lower.includes("screen") || lower.includes("page")) return "view";
  if (lower.includes("repository") || lower.includes("client") || lower.includes("service")) return "repository";
  if (lower.includes("request") || lower.includes("response") || lower.includes("api")) return "api";
  if (lower.includes("mock") || lower.includes("stub") || lower.includes("fake")) return "mock";
  if (lower.includes("test")) return "test";
  if (lower.includes("model") || lower.includes("dto") || lower.includes("entity")) return "model";

  // Content-based heuristics
  if (content.includes("@Reducer") || content.includes("Reduce {")) return "reducer";
  if (content.includes("struct") && content.includes("Equatable") && content.includes("var")) return "state";
  if (content.includes("enum") && content.includes("case") && content.includes("Action")) return "action";
  if (content.includes("View {") || content.includes("some View")) return "view";
  if (content.includes("RepositoryAPI") || content.includes("ServiceAPI")) return "repository";
  if (content.includes("Codable") || content.includes("Decodable")) return "model";

  return "other";
}

function summarizeSwiftFile(content: string, category: string): string {
  const lines = content.split("\n");
  const structs = lines.filter((l) => l.match(/^\s*(public\s+)?struct\s+\w+/)).map((l) => l.trim());
  const enums = lines.filter((l) => l.match(/^\s*(public\s+)?enum\s+\w+/)).map((l) => l.trim());
  const protocols = lines.filter((l) => l.match(/^\s*(public\s+)?protocol\s+\w+/)).map((l) => l.trim());
  const funcs = lines
    .filter((l) => l.match(/^\s*(public\s+)?(func|static func)\s+\w+/))
    .map((l) => l.trim())
    .slice(0, 10);

  const parts: string[] = [];
  if (structs.length) parts.push(`Structs: ${structs.join("; ")}`);
  if (enums.length) parts.push(`Enums: ${enums.join("; ")}`);
  if (protocols.length) parts.push(`Protocols: ${protocols.join("; ")}`);
  if (funcs.length) parts.push(`Functions (up to 10): ${funcs.join("; ")}`);

  return parts.join("\n    ") || "(empty or non-standard structure)";
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

export async function getFeature(input: GetFeatureInput): Promise<string> {
  // Find the module directory
  const modulesDir = repoPath("Modules");
  const entries = await listDir(modulesDir);

  const featureName = input.feature.replace(/^Feature/i, "");
  const candidates = entries.filter((e) => {
    const lower = e.toLowerCase();
    return (
      lower === `feature${featureName.toLowerCase()}` ||
      lower === `feature${featureName.toLowerCase()}core` ||
      lower.includes(featureName.toLowerCase())
    );
  });

  if (candidates.length === 0) {
    return `No module found matching "${input.feature}". Use list_modules to see available modules.`;
  }

  const output: string[] = [];
  output.push(`# Feature: ${input.feature}`);
  output.push(`Matched modules: ${candidates.join(", ")}\n`);

  for (const moduleName of candidates) {
    const modulePath = join(modulesDir, moduleName);
    output.push(`\n## Module: ${moduleName}`);
    output.push(`Path: Modules/${moduleName}`);

    // Parse Package.swift
    const pkgPath = join(modulePath, "Package.swift");
    if (await fileExists(pkgPath)) {
      const pkgContent = await readTextFile(pkgPath);
      const products = [...pkgContent.matchAll(/\.library\(\s*name:\s*"([^"]+)"/g)].map(
        (m) => m[1]
      );
      output.push(`Products: ${products.join(", ")}`);
    }

    // Walk source files
    const sourcesDir = join(modulePath, "Sources");
    if (!(await isDirectory(sourcesDir))) continue;

    const swiftFiles = await walkSwiftFiles(sourcesDir);

    const categorized: Record<string, FeatureFile[]> = {};

    for (const filePath of swiftFiles) {
      const content = await readTextFile(filePath);
      const category = categorizeFile(filePath.split("/").pop() || "", content);
      const rel = relPath(filePath);
      const summary = summarizeSwiftFile(content, category);

      if (!categorized[category]) categorized[category] = [];
      categorized[category].push({ relativePath: rel, category, summary });

      // Include full source for key files if requested
      if (input.include_source && ["reducer", "state", "action", "model", "api"].includes(category)) {
        // We'll include these below
      }
    }

    // Output by category
    const categoryOrder: FeatureFile["category"][] = [
      "reducer", "state", "action", "model", "api", "repository", "view", "mock", "test", "other",
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

    // Include full source of key files
    if (input.include_source) {
      output.push(`\n### KEY FILE SOURCES`);
      for (const cat of ["reducer", "state", "action", "model", "api"] as const) {
        const files = categorized[cat];
        if (!files) continue;
        for (const f of files.slice(0, 3)) {
          // Max 3 per category
          const content = await readTextFile(repoPath(f.relativePath));
          output.push(`\n--- ${f.relativePath} (${cat}) ---`);
          output.push("```swift");
          output.push(content.slice(0, 5000)); // Cap at 5KB per file
          if (content.length > 5000) output.push("\n// ... truncated ...");
          output.push("```");
        }
      }
    }
  }

  return output.join("\n");
}
