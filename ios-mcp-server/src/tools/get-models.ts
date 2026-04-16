/**
 * Tool: get_models
 * Extracts data models, DTOs, request/response structs, and enums for a feature.
 * Shows field names, types, optionality, coding keys, and conformances —
 * everything an Android dev needs to build the Kotlin equivalent.
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

export const getModelsSchema = z.object({
  feature: z
    .string()
    .describe(
      'Feature name, e.g. "Transaction", "KYC", "Authentication". Searches Feature{name} modules.'
    ),
  include_enums: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include enum definitions (default: true)."),
  include_source: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include full source code of each model file (default: false)."),
});

export type GetModelsInput = z.infer<typeof getModelsSchema>;

interface ModelInfo {
  name: string;
  kind: "struct" | "enum" | "class";
  conformances: string[];
  properties: PropertyInfo[];
  cases?: string[];
  codingKeys?: string[];
  file: string;
  rawSource?: string;
}

interface PropertyInfo {
  name: string;
  type: string;
  isOptional: boolean;
  isLet: boolean;
  defaultValue?: string;
}

function parseModels(content: string, filePath: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match struct/enum/class declarations
    const declMatch = line.match(
      /^\s*(?:public\s+|internal\s+|private\s+)?(?:final\s+)?(struct|enum|class)\s+(\w+)\s*(?::\s*(.+?))?\s*\{/
    );
    if (!declMatch) continue;

    const kind = declMatch[1] as "struct" | "enum" | "class";
    const name = declMatch[2];
    const conformanceStr = declMatch[3] || "";
    const conformances = conformanceStr
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    // Check if this looks like a data model
    const isModel =
      conformances.some((c) =>
        [
          "Codable",
          "Decodable",
          "Encodable",
          "Equatable",
          "Hashable",
          "Identifiable",
        ].includes(c)
      ) ||
      name.endsWith("Request") ||
      name.endsWith("Response") ||
      name.endsWith("Model") ||
      name.endsWith("DTO") ||
      name.endsWith("Payload") ||
      name.endsWith("State") ||
      name.endsWith("Entity");

    if (!isModel) continue;

    // Extract body until matching closing brace
    let braceCount = 1;
    let j = i + 1;
    const bodyLines: string[] = [];
    while (j < lines.length && braceCount > 0) {
      const bodyLine = lines[j];
      braceCount += (bodyLine.match(/\{/g) || []).length;
      braceCount -= (bodyLine.match(/\}/g) || []).length;
      if (braceCount > 0) bodyLines.push(bodyLine);
      j++;
    }

    const body = bodyLines.join("\n");
    const properties: PropertyInfo[] = [];
    const cases: string[] = [];
    let codingKeys: string[] | undefined;

    // Extract properties
    for (const bodyLine of bodyLines) {
      const propMatch = bodyLine.match(
        /^\s*(?:public\s+|internal\s+|private\s+)?(let|var)\s+(\w+)\s*:\s*(.+?)(?:\s*=\s*(.+))?$/
      );
      if (propMatch) {
        let type = propMatch[3].trim();
        const isOptional = type.endsWith("?") || type.startsWith("Optional<");
        if (type.endsWith("?")) type = type.slice(0, -1);

        properties.push({
          name: propMatch[2],
          type,
          isOptional,
          isLet: propMatch[1] === "let",
          defaultValue: propMatch[4]?.trim(),
        });
      }

      // Extract enum cases
      if (kind === "enum") {
        const caseMatch = bodyLine.match(/^\s*case\s+(\w+)/);
        if (caseMatch) cases.push(caseMatch[1]);
      }
    }

    // Extract CodingKeys
    const codingKeysMatch = body.match(
      /enum\s+CodingKeys\s*:\s*String\s*,\s*CodingKey\s*\{([^}]+)\}/s
    );
    if (codingKeysMatch) {
      codingKeys = [];
      const keyMatches = codingKeysMatch[1].matchAll(
        /case\s+(\w+)\s*=\s*"([^"]+)"/g
      );
      for (const km of keyMatches) {
        codingKeys.push(`${km[1]} → "${km[2]}"`);
      }
      // Also catch cases without custom string
      const simpleKeys = codingKeysMatch[1].matchAll(
        /case\s+(\w+)\s*(?:,|\s*$)/gm
      );
      for (const sk of simpleKeys) {
        if (!codingKeys.some((k) => k.startsWith(sk[1]))) {
          codingKeys.push(sk[1]);
        }
      }
    }

    // Get raw source for this model
    const rawSource = [lines[i], ...bodyLines, "}"].join("\n");

    models.push({
      name,
      kind,
      conformances,
      properties,
      cases: cases.length > 0 ? cases : undefined,
      codingKeys: codingKeys && codingKeys.length > 0 ? codingKeys : undefined,
      file: filePath,
      rawSource,
    });
  }

  return models;
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

export async function getModels(input: GetModelsInput): Promise<string> {
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

  const allModels: ModelInfo[] = [];

  for (const moduleName of candidates) {
    const sourcesDir = join(modulesDir, moduleName, "Sources");
    if (!(await isDirectory(sourcesDir))) continue;

    const swiftFiles = await walkSwiftFiles(sourcesDir);

    for (const filePath of swiftFiles) {
      // Skip mock/test files
      const rel = relPath(filePath);
      if (rel.toLowerCase().includes("mock") || rel.toLowerCase().includes("test")) continue;

      const content = await readTextFile(filePath);
      const models = parseModels(content, rel);

      for (const model of models) {
        if (model.kind === "enum" && !input.include_enums) continue;
        allModels.push(model);
      }
    }
  }

  if (allModels.length === 0) {
    return `No data models found for "${input.feature}".`;
  }

  // Group by layer (Domain, Data, UI)
  const grouped: Record<string, ModelInfo[]> = {};
  for (const model of allModels) {
    let layer = "Other";
    if (model.file.includes("Domain")) layer = "Domain";
    else if (model.file.includes("Data")) layer = "Data";
    else if (model.file.includes("UI")) layer = "UI";
    else if (model.file.includes("Core")) layer = "Core";
    if (!grouped[layer]) grouped[layer] = [];
    grouped[layer].push(model);
  }

  const output: string[] = [
    `# Models — ${input.feature}`,
    `Found ${allModels.length} models across ${candidates.join(", ")}.\n`,
  ];

  const layerOrder = ["Domain", "Core", "Data", "UI", "Other"];
  for (const layer of layerOrder) {
    const models = grouped[layer];
    if (!models || models.length === 0) continue;

    output.push(`\n## ${layer} Layer (${models.length} models)\n`);

    for (const m of models) {
      output.push(`### ${m.kind} ${m.name}`);
      output.push(`  File: ${m.file}`);
      if (m.conformances.length > 0)
        output.push(`  Conforms to: ${m.conformances.join(", ")}`);

      if (m.properties.length > 0) {
        output.push(`  Properties:`);
        for (const p of m.properties) {
          const opt = p.isOptional ? "?" : "";
          const mut = p.isLet ? "let" : "var";
          const def = p.defaultValue ? ` = ${p.defaultValue}` : "";
          output.push(`    ${mut} ${p.name}: ${p.type}${opt}${def}`);
        }
      }

      if (m.cases && m.cases.length > 0) {
        output.push(`  Cases: ${m.cases.join(", ")}`);
      }

      if (m.codingKeys && m.codingKeys.length > 0) {
        output.push(`  CodingKeys:`);
        for (const ck of m.codingKeys) {
          output.push(`    ${ck}`);
        }
      }

      if (input.include_source && m.rawSource) {
        output.push(`\n\`\`\`swift\n${m.rawSource}\n\`\`\``);
      }

      output.push("");
    }
  }

  return output.join("\n");
}
