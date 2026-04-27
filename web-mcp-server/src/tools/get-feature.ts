import { z } from "zod";
import { repoPath, listDir, isDirectory, readTextFile, relPath, walkFiles } from "../repo.js";
import { join } from "path";

export const getFeatureSchema = z.object({
  feature: z.string().describe('Feature name, e.g. "lending", "brokerage", "earn".'),
  include_source: z.boolean().optional().default(false)
    .describe("If true, include full source of component, hook, and model files."),
});

export type GetFeatureInput = z.infer<typeof getFeatureSchema>;

type FileCategory = "component" | "hook" | "api" | "context" | "model" | "test" | "other";

interface FeatureFile {
  relativePath: string;
  category: FileCategory;
  summary: string;
  source?: string;
}

function categorize(filename: string, content: string): FileCategory {
  const lower = filename.toLowerCase();
  if (lower.includes(".test.") || lower.includes(".spec.")) return "test";
  if (filename.match(/^use[A-Z]/) || content.match(/^export (?:default )?(?:async )?function use\w+/m) || content.match(/^export const use\w+ =/m)) return "hook";
  if (lower.includes("context") || lower.includes("provider") || content.includes("createContext(")) return "context";
  if (
    lower.includes("api") || lower.includes("service") || lower.includes("fetcher") ||
    content.includes('from "../../generated') || content.includes('from "../generated') ||
    content.includes('/generated/')
  ) return "api";
  if (
    lower.includes("model") || lower.includes("types") || lower.includes("schema") ||
    (content.includes("z.object") && content.includes("export "))
  ) return "model";
  if (filename.endsWith(".tsx") || content.includes("React.FC") || content.includes("JSX.Element")) return "component";
  if (content.includes("export interface ") || content.includes("export type ")) return "model";
  return "other";
}

function summarizeTsFile(content: string): string {
  const summaries: string[] = [];
  for (const line of content.split("\n")) {
    if (line.match(/^export (?:default )?(?:async )?(?:function|const|class|interface|type|enum) (\w+)/)) {
      summaries.push(line.trim().substring(0, 80));
    }
  }
  return summaries.slice(0, 8).join("; ") || "(no top-level exports found)";
}


async function findMatchingDirs(featureName: string): Promise<string[]> {
  const searchBases = ["src/pages", "src/features", "src/components", "src/hooks"];
  const f = featureName.toLowerCase();
  const candidates: string[] = [];

  for (const base of searchBases) {
    const absBase = repoPath(base);
    const entries = await listDir(absBase);
    for (const entry of entries) {
      if (entry.toLowerCase().includes(f)) {
        const full = join(absBase, entry);
        if (await isDirectory(full)) candidates.push(full);
      }
    }
    for (const entry of entries) {
      if (entry.toLowerCase().includes(f) && (entry.endsWith(".ts") || entry.endsWith(".tsx"))) {
        candidates.push(join(absBase, entry));
      }
    }
  }
  return [...new Set(candidates)];
}

export async function getFeature(input: GetFeatureInput): Promise<string> {
  const dirs = await findMatchingDirs(input.feature);

  if (dirs.length === 0) {
    return `No directories found matching "${input.feature}". Try list_modules to see available modules.`;
  }

  const files: FeatureFile[] = [];
  for (const dir of dirs) {
    const tsFiles = await walkFiles(dir, [".ts", ".tsx"]);
    for (const f of tsFiles) {
      const rel = relPath(f);
      if (rel.includes("node_modules") || rel.includes("/dist/")) continue;
      const content = await readTextFile(f);
      const filename = f.split("/").pop()!;
      const category = categorize(filename, content);
      const ff: FeatureFile = { relativePath: rel, category, summary: summarizeTsFile(content) };
      if (input.include_source && ["component", "hook", "model"].includes(category)) {
        ff.source = content;
      }
      files.push(ff);
    }
  }

  files.sort((a, b) => a.category.localeCompare(b.category) || a.relativePath.localeCompare(b.relativePath));

  const output: string[] = [
    `# Feature: ${input.feature}`,
    `Matched: ${dirs.map((d) => relPath(d)).join(", ")}`,
    `Total files: ${files.length}\n`,
  ];

  const byCategory = new Map<string, FeatureFile[]>();
  for (const f of files) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category)!.push(f);
  }

  const labels: Record<string, string> = {
    component: "Components",
    hook: "Hooks",
    api: "API / Services",
    context: "Contexts / Providers",
    model: "Models / Types",
    test: "Tests",
    other: "Other",
  };

  for (const cat of ["component", "hook", "api", "context", "model", "test", "other"]) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;
    output.push(`\n## ${labels[cat]} (${items.length})\n`);
    for (const f of items) {
      output.push(`### ${f.relativePath}`);
      output.push(`  ${f.summary}`);
      if (f.source) output.push(`\n\`\`\`typescript\n${f.source}\n\`\`\``);
      output.push("");
    }
  }

  return output.join("\n");
}
