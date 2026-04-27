import { z } from "zod";
import { repoPath, readTextFile, relPath, fileExists, walkFiles } from "../repo.js";

export const getModelsSchema = z.object({
  feature: z.string().describe('Feature name, e.g. "lending", "brokerage".'),
  include_source: z.boolean().optional().default(false)
    .describe("If true, includes full source of matched type definition files."),
});

export type GetModelsInput = z.infer<typeof getModelsSchema>;

interface ModelDef {
  name: string;
  kind: "interface" | "type" | "zod-schema" | "enum";
  fields?: string[];
  file: string;
  source?: string;
}

function extractModels(content: string, filePath: string, includeSource: boolean): ModelDef[] {
  const models: ModelDef[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const ifaceMatch = line.match(/^export (?:default )?interface (\w+)/);
    if (ifaceMatch) {
      const fields: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].match(/^}/)) {
        const f = lines[j].trim().match(/^(\w+)\??:\s*(.+?);/);
        if (f) fields.push(`${f[1]}: ${f[2]}`);
        j++;
      }
      const src = includeSource ? lines.slice(i, j + 1).join("\n") : undefined;
      models.push({ name: ifaceMatch[1], kind: "interface", fields, file: filePath, source: src });
    }

    const typeMatch = line.match(/^export type (\w+)\s*=/);
    if (typeMatch && !line.includes("=>")) {
      models.push({ name: typeMatch[1], kind: "type", file: filePath,
        source: includeSource ? line : undefined });
    }

    const zodMatch = line.match(/^export const (\w+(?:Schema)?)\s*=\s*z\.(?:object|array|union|string|number)/);
    if (zodMatch) {
      const src = includeSource ? lines.slice(i, Math.min(i + 12, lines.length)).join("\n") : undefined;
      models.push({ name: zodMatch[1], kind: "zod-schema", file: filePath, source: src });
    }

    const enumMatch = line.match(/^(?:export )?(?:const )?enum (\w+)\s*\{/);
    if (enumMatch) {
      const cases: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith("}")) {
        const c = lines[j].trim().match(/^([A-Z_][A-Z0-9_]*)/);
        if (c) cases.push(c[1]);
        j++;
      }
      models.push({ name: enumMatch[1], kind: "enum", fields: cases, file: filePath });
    }
  }

  return models;
}


export async function getModels(input: GetModelsInput): Promise<string> {
  const searchDirs = ["src/models", "src/features", "src/components", "src/generated/openapi"];
  const f = input.feature.toLowerCase();
  const allModels: ModelDef[] = [];

  for (const base of searchDirs) {
    const absBase = repoPath(base);
    if (!(await fileExists(absBase))) continue;
    const files = (await walkFiles(absBase, [".ts", ".tsx"]))
      .filter(f => !f.includes(".test.") && !f.includes(".spec."));
    for (const file of files) {
      const rel = relPath(file);
      if (!rel.toLowerCase().includes(f)) continue;
      const content = await readTextFile(file);
      allModels.push(...extractModels(content, rel, input.include_source));
    }
  }

  if (allModels.length === 0) {
    return `No models found for "${input.feature}". Try search_code with 'interface' or 'type'.`;
  }

  const out: string[] = [`# Models — ${input.feature}\nFound ${allModels.length} definitions.\n`];

  const byKind = new Map<string, ModelDef[]>();
  for (const m of allModels) {
    if (!byKind.has(m.kind)) byKind.set(m.kind, []);
    byKind.get(m.kind)!.push(m);
  }

  const kindLabels: Record<string, string> = {
    interface: "Interfaces",
    type: "Type Aliases",
    "zod-schema": "Zod Schemas",
    enum: "Enums",
  };

  for (const kind of ["interface", "type", "zod-schema", "enum"]) {
    const items = byKind.get(kind);
    if (!items || items.length === 0) continue;
    out.push(`\n## ${kindLabels[kind]} (${items.length})\n`);
    for (const m of items) {
      out.push(`### ${m.name} — ${m.file}`);
      if (m.fields && m.fields.length > 0) out.push(`  Fields: ${m.fields.join(", ")}`);
      if (m.source) out.push(`\n\`\`\`typescript\n${m.source}\n\`\`\``);
      out.push("");
    }
  }

  return out.join("\n");
}
