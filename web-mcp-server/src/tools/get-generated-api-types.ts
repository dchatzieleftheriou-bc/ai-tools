import { z } from "zod";
import { repoPath, listDir, readTextFile, fileExists } from "../repo.js";
import { join } from "path";

export const getGeneratedApiTypesSchema = z.object({
  filter: z.string().optional().describe("Optional spec name filter, e.g. 'lending'."),
});

export type GetGeneratedApiTypesInput = z.infer<typeof getGeneratedApiTypesSchema>;

interface EndpointInfo {
  name: string;
  method: string;
  path: string;
}

function parseGeneratedFetchers(content: string): EndpointInfo[] {
  const endpoints: EndpointInfo[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const funcMatch = lines[i].match(/^export const (\w+)\s*=/);
    if (!funcMatch) continue;

    const name = funcMatch[1];
    let method = "";
    let path = "";

    for (let j = i; j < Math.min(i + 15, lines.length); j++) {
      const methodMatch = lines[j].match(/method:\s*['"](\w+)['"]/i);
      if (methodMatch && !method) method = methodMatch[1].toUpperCase();
      const urlMatch = lines[j].match(/url:\s*`([^`]+)`|url:\s*['"]([^'"]+)['"]/);
      if (urlMatch && !path) path = urlMatch[1] || urlMatch[2];
    }

    if (name && (method || path)) {
      endpoints.push({ name, method: method || "?", path: path || "" });
    }
  }

  return endpoints;
}

export async function getGeneratedApiTypes(input: GetGeneratedApiTypesInput): Promise<string> {
  const openApiDir = repoPath("openapi");
  const genDir = repoPath("src", "generated", "openapi");

  const out: string[] = [`# Generated API Types (Orval)\n`];

  if (await fileExists(openApiDir)) {
    const specFiles = (await listDir(openApiDir)).filter((f) =>
      f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json")
    );
    out.push(`## OpenAPI Specs in openapi/\n`);
    for (const spec of specFiles) {
      if (!input.filter || spec.toLowerCase().includes(input.filter.toLowerCase())) {
        out.push(`  ${spec}`);
      }
    }
    out.push("");
  }

  if (!(await fileExists(genDir))) {
    out.push("## Generated Files\n  (src/generated/openapi/ not found — run `npm run generate-types`)\n");
    return out.join("\n");
  }

  const genFiles = (await listDir(genDir)).filter((f) => f.endsWith(".ts"));
  out.push(`## Generated Files in src/generated/openapi/\n`);

  for (const gen of genFiles) {
    if (input.filter && !gen.toLowerCase().includes(input.filter.toLowerCase())) continue;
    out.push(`### ${gen}`);

    try {
      const content = await readTextFile(join(genDir, gen));
      const endpoints = parseGeneratedFetchers(content);

      if (endpoints.length > 0) {
        for (const e of endpoints.slice(0, 30)) {
          const pathStr = e.path ? `  ${e.method} ${e.path}` : "";
          out.push(`  ${e.name}()${pathStr ? " —" + pathStr : ""}`);
        }
        if (endpoints.length > 30) out.push(`  ... and ${endpoints.length - 30} more functions`);
      } else {
        const exports = [...content.matchAll(/^export (?:const|type|interface) (\w+)/gm)].map((m) => m[1]);
        for (const e of exports.slice(0, 20)) out.push(`  ${e}`);
        if (exports.length > 20) out.push(`  ... and ${exports.length - 20} more exports`);
      }
    } catch {
      out.push("  (could not read file)");
    }
    out.push("");
  }

  return out.join("\n");
}
