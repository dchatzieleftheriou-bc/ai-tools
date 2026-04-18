/**
 * Tool: get_api_endpoints
 * Discovers Retrofit API interfaces, DTOs, and network calls across the Android codebase.
 */
import { z } from "zod";
import { grepRepo, getRepoRoot, repoPath, readTextFile, fileExists, listDir, isDirectory, relPath } from "../repo.js";
import { join } from "path";

export const getApiEndpointsSchema = z.object({
  feature: z.string().optional().describe('Scope to a feature, e.g. "earn", "lending". If omitted, searches entire codebase.'),
  search_term: z.string().optional().describe('Additional keyword filter, e.g. "swap", "order", "card".'),
});

export type GetApiEndpointsInput = z.infer<typeof getApiEndpointsSchema>;

async function walkKotlinFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await listDir(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      if (await isDirectory(full)) results.push(...(await walkKotlinFiles(full)));
      else if (entry.endsWith(".kt")) results.push(full);
    }
  } catch { /* dir doesn't exist */ }
  return results;
}

export async function getApiEndpoints(input: GetApiEndpointsInput): Promise<string> {
  const root = getRepoRoot();
  const output: string[] = [];
  const seen = new Set<string>();

  // 1. Find Retrofit interface files (primarily in blockchainApi)
  const retrofitInterfaces = grepRepo("@GET\\|@POST\\|@PUT\\|@DELETE\\|@PATCH\\|@HTTP", {
    glob: "*.kt",
    maxResults: 300,
    caseSensitive: true,
  });

  const apiLines: string[] = [];
  for (const line of retrofitInterfaces.split("\n").filter(Boolean)) {
    const relLine = line.substring(root.length + 1);
    if (input.feature && !relLine.toLowerCase().includes(input.feature.toLowerCase())) continue;
    if (input.search_term && !relLine.toLowerCase().includes(input.search_term.toLowerCase())) continue;
    if (!seen.has(relLine)) { seen.add(relLine); apiLines.push(relLine); }
  }

  // 2. Find DTO / Request / Response models
  const dtoModels = grepRepo("@Serializable\\s*\\ndata class|data class.*Dto|data class.*Request|data class.*Response", {
    glob: "*.kt",
    maxResults: 200,
  });

  const dtoLines: string[] = [];
  for (const line of dtoModels.split("\n").filter(Boolean)) {
    const relLine = line.substring(root.length + 1);
    if (input.feature && !relLine.toLowerCase().includes(input.feature.toLowerCase())) continue;
    if (input.search_term && !relLine.toLowerCase().includes(input.search_term.toLowerCase())) continue;
    if (!seen.has(relLine)) { seen.add(relLine); dtoLines.push(relLine); }
  }

  // 3. Find Service wrappers (ApiService classes)
  const serviceClasses = grepRepo("class\\s+\\w+(?:Api)?Service|interface\\s+\\w+(?:Api)?Service", {
    glob: "*.kt",
    maxResults: 100,
  });

  const serviceLines: string[] = [];
  for (const line of serviceClasses.split("\n").filter(Boolean)) {
    const relLine = line.substring(root.length + 1);
    if (input.feature && !relLine.toLowerCase().includes(input.feature.toLowerCase())) continue;
    if (input.search_term && !relLine.toLowerCase().includes(input.search_term.toLowerCase())) continue;
    if (!seen.has(relLine)) { seen.add(relLine); serviceLines.push(relLine); }
  }

  // 4. Find Retrofit interface declarations
  const interfaceDecls = grepRepo("interface\\s+\\w+Interface|interface\\s+\\w+Api\\b", {
    glob: "*.kt",
    maxResults: 100,
  });

  const ifaceLines: string[] = [];
  for (const line of interfaceDecls.split("\n").filter(Boolean)) {
    const relLine = line.substring(root.length + 1);
    if (input.feature && !relLine.toLowerCase().includes(input.feature.toLowerCase())) continue;
    if (input.search_term && !relLine.toLowerCase().includes(input.search_term.toLowerCase())) continue;
    if (!seen.has(relLine)) { seen.add(relLine); ifaceLines.push(relLine); }
  }

  const total = apiLines.length + dtoLines.length + serviceLines.length + ifaceLines.length;
  if (total === 0) {
    return `No API endpoints found${input.feature ? ` for "${input.feature}"` : ""}${input.search_term ? ` matching "${input.search_term}"` : ""}.`;
  }

  output.push(`# API Endpoints${input.feature ? ` — ${input.feature}` : ""}${input.search_term ? ` (filter: "${input.search_term}")` : ""}`);
  output.push(`Found ${total} results:\n`);

  if (ifaceLines.length > 0) {
    output.push(`\n## Retrofit Interface Declarations (${ifaceLines.length})`);
    for (const l of ifaceLines.slice(0, 30)) output.push(`  ${l}`);
    if (ifaceLines.length > 30) output.push(`  ... and ${ifaceLines.length - 30} more`);
  }

  if (apiLines.length > 0) {
    output.push(`\n## API Endpoints (@GET, @POST, etc.) (${apiLines.length})`);
    for (const l of apiLines.slice(0, 50)) output.push(`  ${l}`);
    if (apiLines.length > 50) output.push(`  ... and ${apiLines.length - 50} more`);
  }

  if (dtoLines.length > 0) {
    output.push(`\n## DTOs / Request / Response Models (${dtoLines.length})`);
    for (const l of dtoLines.slice(0, 30)) output.push(`  ${l}`);
    if (dtoLines.length > 30) output.push(`  ... and ${dtoLines.length - 30} more`);
  }

  if (serviceLines.length > 0) {
    output.push(`\n## API Service Wrappers (${serviceLines.length})`);
    for (const l of serviceLines.slice(0, 30)) output.push(`  ${l}`);
  }

  return output.join("\n");
}
