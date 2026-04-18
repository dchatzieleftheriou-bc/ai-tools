/**
 * Tool: get_di_registrations
 * Shows Koin dependency injection registrations for a feature area.
 * Finds module {} blocks, viewModel {}, factory {}, scoped {}, single {} declarations.
 */
import { z } from "zod";
import { repoPath, listDir, isDirectory, readTextFile, relPath, grepRepo, getRepoRoot } from "../repo.js";
import { join } from "path";

export const getDiRegistrationsSchema = z.object({
  feature: z.string().optional().describe('Feature name to scope results, e.g. "earn", "lending". If omitted, shows all.'),
});

export type GetDiRegistrationsInput = z.infer<typeof getDiRegistrationsSchema>;

interface KoinRegistration {
  scope: "viewModel" | "factory" | "single" | "scoped" | "named";
  binding: string;
  file: string;
  snippet: string;
}

function parseKoinModules(content: string, filePath: string): KoinRegistration[] {
  const regs: KoinRegistration[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // viewModel { SomeViewModel(...) }
    const vmMatch = line.match(/viewModel\s*(?:<(\w+)>)?\s*\{/);
    if (vmMatch) {
      const snippet = lines.slice(i, Math.min(i + 3, lines.length)).map((l) => l.trim()).join("\n      ");
      const binding = vmMatch[1] || extractBinding(snippet);
      regs.push({ scope: "viewModel", binding, file: filePath, snippet });
    }

    // factory { SomeClass(...) }
    const factoryMatch = line.match(/factory\s*(?:<(\w+)>)?\s*\{/);
    if (factoryMatch && !line.includes("viewModel")) {
      const snippet = lines.slice(i, Math.min(i + 3, lines.length)).map((l) => l.trim()).join("\n      ");
      const binding = factoryMatch[1] || extractBinding(snippet);
      regs.push({ scope: "factory", binding, file: filePath, snippet });
    }

    // single { SomeClass(...) }
    const singleMatch = line.match(/single\s*(?:<(\w+)>)?\s*\{/);
    if (singleMatch) {
      const snippet = lines.slice(i, Math.min(i + 3, lines.length)).map((l) => l.trim()).join("\n      ");
      const binding = singleMatch[1] || extractBinding(snippet);
      regs.push({ scope: "single", binding, file: filePath, snippet });
    }

    // scoped { SomeClass(...) }
    const scopedMatch = line.match(/scoped\s*(?:<(\w+)>)?\s*\{/);
    if (scopedMatch) {
      const snippet = lines.slice(i, Math.min(i + 3, lines.length)).map((l) => l.trim()).join("\n      ");
      const binding = scopedMatch[1] || extractBinding(snippet);
      regs.push({ scope: "scoped", binding, file: filePath, snippet });
    }

    // named("...") / qualifier
    const namedMatch = line.match(/named\s*\(\s*["']([^"']+)["']\s*\)/);
    if (namedMatch) {
      regs.push({ scope: "named", binding: namedMatch[1], file: filePath, snippet: line.trim() });
    }
  }

  return regs;
}

function extractBinding(snippet: string): string {
  // Try to find the class being constructed
  const match = snippet.match(/(\w+)\s*\(/);
  return match ? match[1] : "unknown";
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

export async function getDiRegistrations(input: GetDiRegistrationsInput): Promise<string> {
  const root = getRepoRoot();

  // Find Koin module files
  const koinFiles = grepRepo("module\\s*\\{|val\\s+\\w+Module\\s*=\\s*module", {
    glob: "*.kt",
    maxResults: 200,
    filesOnly: true,
  });

  const filePaths = koinFiles.split("\n").filter(Boolean).map((l) => l.trim());

  const allRegs: KoinRegistration[] = [];

  for (const absPath of filePaths) {
    const rel = absPath.startsWith(root) ? absPath.substring(root.length + 1) : absPath;

    if (input.feature && !rel.toLowerCase().includes(input.feature.toLowerCase())) continue;

    try {
      const content = await readTextFile(absPath.startsWith("/") ? absPath : repoPath(rel));
      const regs = parseKoinModules(content, rel);
      allRegs.push(...regs);
    } catch { /* file not readable */ }
  }

  // Also search app/koin for global registrations if feature-scoped
  if (input.feature) {
    const appKoinFiles = grepRepo(input.feature, { glob: "*.kt", maxResults: 50, filesOnly: true });
    for (const absPath of appKoinFiles.split("\n").filter(Boolean)) {
      const rel = absPath.startsWith(root) ? absPath.substring(root.length + 1) : absPath;
      if (!rel.includes("koin") && !rel.includes("Koin") && !rel.includes("Module")) continue;
      try {
        const content = await readTextFile(absPath.startsWith("/") ? absPath : repoPath(rel));
        if (content.includes("module {") || content.includes("module{")) {
          const regs = parseKoinModules(content, rel);
          for (const r of regs) {
            if (!allRegs.some((e) => e.snippet === r.snippet)) allRegs.push(r);
          }
        }
      } catch { /* */ }
    }
  }

  if (allRegs.length === 0) {
    return `No Koin DI registrations found${input.feature ? ` for "${input.feature}"` : ""}. Try search_code with 'module {' or 'viewModel'.`;
  }

  const output: string[] = [
    `# Koin DI Registrations${input.feature ? ` — ${input.feature}` : ""}`,
    `Found ${allRegs.length} registrations.\n`,
  ];

  // Group by scope
  const byScope = new Map<string, KoinRegistration[]>();
  for (const r of allRegs) {
    if (!byScope.has(r.scope)) byScope.set(r.scope, []);
    byScope.get(r.scope)!.push(r);
  }

  const scopeLabels: Record<string, string> = {
    viewModel: "ViewModels",
    single: "Singletons",
    factory: "Factories",
    scoped: "Scoped Bindings",
    named: "Named / Qualified",
  };

  for (const scope of ["viewModel", "single", "factory", "scoped", "named"]) {
    const items = byScope.get(scope);
    if (!items || items.length === 0) continue;

    output.push(`\n## ${scopeLabels[scope] || scope} (${items.length})\n`);
    for (const r of items) {
      output.push(`  ${r.binding}`);
      output.push(`    ${r.snippet}`);
      output.push(`    File: ${r.file}`);
      output.push("");
    }
  }

  return output.join("\n");
}
