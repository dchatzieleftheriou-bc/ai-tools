/**
 * Tool: get_di_registrations
 * Shows dependency injection registrations for a feature area.
 * Covers both DIKit (legacy container) and swift-dependencies (@Dependency).
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

export const getDiRegistrationsSchema = z.object({
  feature: z
    .string()
    .optional()
    .describe(
      'Feature name to scope results, e.g. "Transaction", "KYC". If omitted, shows all registrations.'
    ),
  system: z
    .enum(["all", "dikit", "dependencies"])
    .optional()
    .default("all")
    .describe(
      "'dikit' for legacy DIKit registrations, 'dependencies' for TCA-style @Dependency, 'all' for both. Default: 'all'"
    ),
});

export type GetDiRegistrationsInput = z.infer<typeof getDiRegistrationsSchema>;

interface DiKitRegistration {
  scope: "factory" | "single";
  tag?: string;
  protocol: string;
  implementation: string;
  file: string;
  snippet: string;
}

interface SwiftDependency {
  name: string;
  type: string;
  file: string;
  snippet: string;
  kind: "usage" | "definition" | "liveValue";
}

function parseDiKitRegistrations(content: string, filePath: string): DiKitRegistration[] {
  const registrations: DiKitRegistration[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: factory { ... as SomeProtocol }
    // Match: single { ... as SomeProtocol }
    // Match: factory(tag: "...") { ... as SomeProtocol }
    const regMatch = line.match(
      /\b(factory|single)\s*(?:\(\s*tag:\s*"([^"]+)"\s*\))?\s*\{/
    );
    if (!regMatch) continue;

    const scope = regMatch[1] as "factory" | "single";
    const tag = regMatch[2];

    // Look ahead to find the `as` cast which tells us the protocol
    const snippet = lines.slice(i, Math.min(i + 8, lines.length)).join("\n");
    const asMatch = snippet.match(/as\s+(\w+)/);
    const returnMatch = snippet.match(/->\s*(\w+)/);
    const protocol = asMatch ? asMatch[1] : returnMatch ? returnMatch[1] : "unknown";

    // Try to find what's being constructed
    const implMatch = snippet.match(/(\w+)\s*\(/);
    const implementation = implMatch ? implMatch[1] : "unknown";

    registrations.push({
      scope,
      tag,
      protocol,
      implementation,
      file: filePath,
      snippet: lines
        .slice(i, Math.min(i + 4, lines.length))
        .map((l) => l.trim())
        .join("\n      "),
    });
  }

  return registrations;
}

function parseSwiftDependencies(
  content: string,
  filePath: string
): SwiftDependency[] {
  const deps: SwiftDependency[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // @Dependency(\.someName) var someName
    const usageMatch = line.match(
      /@Dependency\s*\(\s*\\\.(\w+)\s*\)\s*var\s+(\w+)\s*(?::\s*(.+))?/
    );
    if (usageMatch) {
      deps.push({
        name: usageMatch[2],
        type: usageMatch[3]?.trim() || usageMatch[1],
        file: filePath,
        snippet: line.trim(),
        kind: "usage",
      });
    }

    // DependencyKey definition
    const keyMatch = line.match(
      /(?:struct|enum)\s+(\w+)\s*:\s*(?:Test)?DependencyKey/
    );
    if (keyMatch) {
      const snippet = lines
        .slice(i, Math.min(i + 6, lines.length))
        .map((l) => l.trim())
        .join("\n      ");
      deps.push({
        name: keyMatch[1],
        type: "DependencyKey",
        file: filePath,
        snippet,
        kind: "definition",
      });
    }

    // liveValue / testValue / previewValue
    const liveMatch = line.match(
      /static\s+(?:let|var)\s+(liveValue|testValue|previewValue)\s*(?::\s*(.+?))?\s*[={]/
    );
    if (liveMatch) {
      const snippet = lines
        .slice(i, Math.min(i + 4, lines.length))
        .map((l) => l.trim())
        .join("\n      ");
      deps.push({
        name: liveMatch[1],
        type: liveMatch[2]?.trim() || "",
        file: filePath,
        snippet,
        kind: "liveValue",
      });
    }
  }

  return deps;
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

export async function getDiRegistrations(
  input: GetDiRegistrationsInput
): Promise<string> {
  const showDiKit = input.system === "all" || input.system === "dikit";
  const showDeps = input.system === "all" || input.system === "dependencies";

  const dikitRegs: DiKitRegistration[] = [];
  const swiftDeps: SwiftDependency[] = [];

  // --- DIKit registrations ---
  if (showDiKit) {
    // DIKit assembly files are in /Blockchain/DIKit/
    const dikitDir = repoPath("Blockchain", "DIKit");
    if (await isDirectory(dikitDir)) {
      const files = await walkSwiftFiles(dikitDir);
      for (const f of files) {
        const content = await readTextFile(f);
        const regs = parseDiKitRegistrations(content, relPath(f));
        dikitRegs.push(...regs);
      }
    }

    // Also check module-level DIKit extensions
    if (input.feature) {
      const modulesDir = repoPath("Modules");
      const entries = await listDir(modulesDir);
      const featureName = input.feature.replace(/^Feature/i, "");
      const candidates = entries.filter((e) =>
        e.toLowerCase().includes(featureName.toLowerCase())
      );

      for (const mod of candidates) {
        const sourcesDir = join(modulesDir, mod, "Sources");
        if (!(await isDirectory(sourcesDir))) continue;
        const files = await walkSwiftFiles(sourcesDir);
        for (const f of files) {
          if (!f.toLowerCase().includes("dikit") && !f.toLowerCase().includes("assembly"))
            continue;
          const content = await readTextFile(f);
          const regs = parseDiKitRegistrations(content, relPath(f));
          dikitRegs.push(...regs);
        }
      }
    }
  }

  // --- swift-dependencies ---
  if (showDeps) {
    const modulesDir = repoPath("Modules");
    const entries = await listDir(modulesDir);

    let modulesToSearch = entries;
    if (input.feature) {
      const featureName = input.feature.replace(/^Feature/i, "");
      modulesToSearch = entries.filter((e) =>
        e.toLowerCase().includes(featureName.toLowerCase())
      );
    }

    for (const mod of modulesToSearch) {
      const sourcesDir = join(modulesDir, mod, "Sources");
      if (!(await isDirectory(sourcesDir))) continue;
      const files = await walkSwiftFiles(sourcesDir);
      for (const f of files) {
        const rel = relPath(f);
        if (rel.toLowerCase().includes("mock") || rel.toLowerCase().includes("test"))
          continue;
        const content = await readTextFile(f);
        if (
          content.includes("@Dependency") ||
          content.includes("DependencyKey") ||
          content.includes("liveValue")
        ) {
          const deps = parseSwiftDependencies(content, rel);
          swiftDeps.push(...deps);
        }
      }
    }
  }

  // --- Build output ---
  const output: string[] = [
    `# Dependency Injection${input.feature ? ` — ${input.feature}` : ""}`,
    "",
  ];

  // Filter DIKit by feature if specified
  let filteredDiKit = dikitRegs;
  if (input.feature) {
    const featureLower = input.feature.replace(/^Feature/i, "").toLowerCase();
    filteredDiKit = dikitRegs.filter(
      (r) =>
        r.protocol.toLowerCase().includes(featureLower) ||
        r.implementation.toLowerCase().includes(featureLower) ||
        r.file.toLowerCase().includes(featureLower)
    );
  }

  if (showDiKit && filteredDiKit.length > 0) {
    const singles = filteredDiKit.filter((r) => r.scope === "single");
    const factories = filteredDiKit.filter((r) => r.scope === "factory");

    output.push(`## DIKit Registrations (${filteredDiKit.length})\n`);

    if (singles.length > 0) {
      output.push(`### Singletons (${singles.length})\n`);
      for (const r of singles) {
        output.push(`  ${r.protocol}${r.tag ? ` [tag: "${r.tag}"]` : ""}`);
        output.push(`    → ${r.implementation}`);
        output.push(`    File: ${r.file}`);
        output.push("");
      }
    }

    if (factories.length > 0) {
      output.push(`### Factories (${factories.length})\n`);
      for (const r of factories) {
        output.push(`  ${r.protocol}${r.tag ? ` [tag: "${r.tag}"]` : ""}`);
        output.push(`    → ${r.implementation}`);
        output.push(`    File: ${r.file}`);
        output.push("");
      }
    }
  }

  if (showDeps && swiftDeps.length > 0) {
    const usages = swiftDeps.filter((d) => d.kind === "usage");
    const definitions = swiftDeps.filter((d) => d.kind === "definition");
    const liveValues = swiftDeps.filter((d) => d.kind === "liveValue");

    output.push(
      `## swift-dependencies / @Dependency (${swiftDeps.length} entries)\n`
    );

    if (definitions.length > 0) {
      output.push(`### DependencyKey Definitions (${definitions.length})\n`);
      for (const d of definitions) {
        output.push(`  ${d.name}`);
        output.push(`    ${d.snippet}`);
        output.push(`    File: ${d.file}`);
        output.push("");
      }
    }

    if (liveValues.length > 0) {
      output.push(`### Live/Test/Preview Values (${liveValues.length})\n`);
      for (const d of liveValues) {
        output.push(`  ${d.name}${d.type ? `: ${d.type}` : ""}`);
        output.push(`    ${d.snippet}`);
        output.push(`    File: ${d.file}`);
        output.push("");
      }
    }

    if (usages.length > 0) {
      output.push(`### @Dependency Usages (${usages.length})\n`);
      for (const d of usages) {
        output.push(`  ${d.snippet}`);
        output.push(`    File: ${d.file}`);
        output.push("");
      }
    }
  }

  if (filteredDiKit.length === 0 && swiftDeps.length === 0) {
    output.push(
      "No DI registrations found. Try broadening your search or using search_code with 'DIKit.resolve' or '@Dependency'."
    );
  }

  return output.join("\n");
}
