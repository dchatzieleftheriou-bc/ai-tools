/**
 * Tool: get_models
 * Extracts data classes, DTOs, sealed interfaces, and enums for a feature.
 * Shows field names, types, defaults, serialization annotations.
 */
import { z } from "zod";
import { repoPath, listDir, isDirectory, readTextFile, relPath } from "../repo.js";
import { join } from "path";

export const getModelsSchema = z.object({
  feature: z.string().describe('Feature name, e.g. "earn", "lending", "dex".'),
  include_enums: z.boolean().optional().default(true),
  include_source: z.boolean().optional().default(false),
});

export type GetModelsInput = z.infer<typeof getModelsSchema>;

interface ModelInfo {
  name: string;
  kind: "data class" | "sealed interface" | "sealed class" | "enum class" | "class" | "object";
  annotations: string[];
  properties: { name: string; type: string; default?: string }[];
  cases?: string[];
  file: string;
  rawSource?: string;
}

function parseModels(content: string, filePath: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Collect annotations above the declaration
    const annotations: string[] = [];
    let lookback = i - 1;
    while (lookback >= 0 && lines[lookback].trim().startsWith("@")) {
      annotations.unshift(lines[lookback].trim());
      lookback--;
    }

    // Match data class, sealed interface/class, enum class, object
    const declMatch = line.match(
      /^\s*(?:public\s+|internal\s+|private\s+)?(data\s+class|sealed\s+interface|sealed\s+class|enum\s+class|object|class)\s+(\w+)/
    );
    if (!declMatch) continue;

    const kind = declMatch[1] as ModelInfo["kind"];
    const name = declMatch[2];

    // For data classes, check if it looks like a model
    const isModel =
      annotations.some((a) => a.includes("@Serializable") || a.includes("@Parcelize")) ||
      kind === "data class" ||
      kind.startsWith("sealed") ||
      kind === "enum class" ||
      name.endsWith("Dto") ||
      name.endsWith("Request") ||
      name.endsWith("Response") ||
      name.endsWith("Model") ||
      name.endsWith("State") ||
      name.endsWith("Intent");

    if (!isModel) continue;
    if (kind === "enum class" && !true) continue; // include_enums checked at caller

    // Extract constructor params for data classes
    const properties: ModelInfo["properties"] = [];
    if (kind === "data class") {
      // Get the constructor block
      const fromHere = lines.slice(i).join("\n");
      const ctorMatch = fromHere.match(/\(([\s\S]*?)\)/);
      if (ctorMatch) {
        const params = ctorMatch[1].split(",");
        for (const param of params) {
          const paramMatch = param.trim().match(/(?:val|var)\s+(\w+)\s*:\s*([^=]+?)(?:\s*=\s*(.+))?$/);
          if (paramMatch) {
            properties.push({
              name: paramMatch[1],
              type: paramMatch[2].trim(),
              default: paramMatch[3]?.trim(),
            });
          }
        }
      }
    }

    // Extract enum cases
    const cases: string[] = [];
    if (kind === "enum class") {
      let j = i + 1;
      let braces = 1;
      while (j < lines.length && braces > 0) {
        const bodyLine = lines[j];
        braces += (bodyLine.match(/\{/g) || []).length;
        braces -= (bodyLine.match(/\}/g) || []).length;
        const caseMatch = bodyLine.match(/^\s*(\w+)\s*(?:\(|,|;|\s*$)/);
        if (caseMatch && caseMatch[1] !== caseMatch[1].toLowerCase() === false) {
          // Enum cases are typically UPPER_CASE or PascalCase
          const c = caseMatch[1];
          if (c && !["override", "fun", "val", "var", "companion", "class"].includes(c)) {
            cases.push(c);
          }
        }
        j++;
      }
    }

    // Get raw source
    let rawSource = "";
    let braces = 0;
    let started = false;
    for (let j = i; j < lines.length; j++) {
      rawSource += lines[j] + "\n";
      braces += (lines[j].match(/\{/g) || []).length;
      braces -= (lines[j].match(/\}/g) || []).length;
      if (braces > 0) started = true;
      if (started && braces <= 0) break;
      if (!lines[j].includes("{") && j === i && lines[j].includes(")")) break; // Single-line data class
    }

    models.push({
      name,
      kind,
      annotations,
      properties,
      cases: cases.length > 0 ? cases : undefined,
      file: filePath,
      rawSource: rawSource.trim(),
    });
  }

  return models;
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

export async function getModels(input: GetModelsInput): Promise<string> {
  const root = repoPath(".");
  const allDirs = await listDir(root);
  const featureName = input.feature.toLowerCase();

  const candidates: string[] = [];
  for (const dir of allDirs) {
    if (dir.toLowerCase().includes(featureName) && await isDirectory(repoPath(dir))) {
      candidates.push(dir);
      // Check for domain/data/presentation sub-modules
      const subs = await listDir(repoPath(dir));
      for (const sub of subs) {
        if (["domain", "data", "presentation"].includes(sub) && await isDirectory(repoPath(dir, sub))) {
          candidates.push(join(dir, sub));
        }
      }
    }
  }

  // Also search blockchainApi for DTOs related to this feature
  const apiDir = repoPath("blockchainApi");
  if (await isDirectory(apiDir)) candidates.push("blockchainApi");

  if (candidates.length === 0) {
    return `No module found matching "${input.feature}".`;
  }

  const allModels: ModelInfo[] = [];
  for (const modulePath of candidates) {
    const srcDir = join(repoPath(modulePath), "src", "main");
    if (!(await isDirectory(srcDir))) continue;

    const files = await walkKotlinFiles(srcDir);
    for (const f of files) {
      const rel = relPath(f);
      if (rel.includes("test") || rel.includes("Test")) continue;

      const content = await readTextFile(f);
      const models = parseModels(content, rel);
      for (const m of models) {
        if (m.kind === "enum class" && !input.include_enums) continue;
        // For blockchainApi, only include if it matches the feature name
        if (modulePath === "blockchainApi" && !m.file.toLowerCase().includes(featureName) && !m.name.toLowerCase().includes(featureName)) continue;
        allModels.push(m);
      }
    }
  }

  if (allModels.length === 0) return `No data models found for "${input.feature}".`;

  // Group by layer
  const grouped: Record<string, ModelInfo[]> = {};
  for (const m of allModels) {
    let layer = "Other";
    if (m.file.includes("/domain/")) layer = "Domain";
    else if (m.file.includes("/data/") || m.file.includes("blockchainApi")) layer = "Data / API";
    else if (m.file.includes("/presentation/")) layer = "Presentation";
    if (!grouped[layer]) grouped[layer] = [];
    grouped[layer].push(m);
  }

  const output: string[] = [`# Models — ${input.feature}`, `Found ${allModels.length} models.\n`];

  for (const layer of ["Domain", "Data / API", "Presentation", "Other"]) {
    const models = grouped[layer];
    if (!models || models.length === 0) continue;

    output.push(`\n## ${layer} (${models.length} models)\n`);
    for (const m of models) {
      output.push(`### ${m.kind} ${m.name}`);
      output.push(`  File: ${m.file}`);
      if (m.annotations.length > 0) output.push(`  Annotations: ${m.annotations.join(" ")}`);
      if (m.properties.length > 0) {
        output.push(`  Properties:`);
        for (const p of m.properties) {
          const def = p.default ? ` = ${p.default}` : "";
          output.push(`    val ${p.name}: ${p.type}${def}`);
        }
      }
      if (m.cases) output.push(`  Cases: ${m.cases.join(", ")}`);
      if (input.include_source && m.rawSource) {
        output.push(`\n\`\`\`kotlin\n${m.rawSource.slice(0, 3000)}\n\`\`\``);
      }
      output.push("");
    }
  }

  return output.join("\n");
}
