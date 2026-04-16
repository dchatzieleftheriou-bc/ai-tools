/**
 * Tool: get_api_endpoints
 * Discovers API endpoints, request/response models, and network calls
 * across the iOS codebase.
 */
import { z } from "zod";
import { grepRepo, getRepoRoot, repoPath, readTextFile } from "../repo.js";

export const getApiEndpointsSchema = z.object({
  feature: z
    .string()
    .optional()
    .describe(
      'Optional feature name to scope the search, e.g. "Transaction", "KYC". If omitted, searches entire codebase.'
    ),
  search_term: z
    .string()
    .optional()
    .describe(
      'Optional additional search term to narrow results, e.g. "swap", "order", "card".'
    ),
});

export type GetApiEndpointsInput = z.infer<typeof getApiEndpointsSchema>;

interface ApiEndpoint {
  file: string;
  type: "url_path" | "request_model" | "response_model" | "network_call" | "api_protocol";
  snippet: string;
}

export async function getApiEndpoints(input: GetApiEndpointsInput): Promise<string> {
  const root = getRepoRoot();
  const scope = input.feature
    ? `Modules/Feature*${input.feature}*`
    : "Modules";
  const scopePath = input.feature ? `*${input.feature}*/**/*.swift` : "*.swift";

  const results: ApiEndpoint[] = [];

  // 1. Find URL path strings (API routes)
  const urlPatterns = [
    '/api/',
    '/v\\d+/',
    'nabu-gateway',
    'explorer-gateway',
    'retailcore',
  ];

  for (const pattern of urlPatterns) {
    const matches = grepRepo(pattern, {
      glob: "*.swift",
      maxResults: 100,
      caseSensitive: false,
    });

    for (const line of matches.split("\n").filter(Boolean)) {
      if (input.feature && !line.toLowerCase().includes(input.feature.toLowerCase())) continue;
      if (input.search_term && !line.toLowerCase().includes(input.search_term.toLowerCase())) continue;
      results.push({
        file: line.substring(root.length + 1).split(":")[0],
        type: "url_path",
        snippet: line.substring(root.length + 1),
      });
    }
  }

  // 2. Find Request/Response models (Codable structs)
  const requestModels = grepRepo("struct.*Request.*Codable|struct.*Request.*Encodable", {
    glob: "*.swift",
    maxResults: 100,
  });
  for (const line of requestModels.split("\n").filter(Boolean)) {
    if (input.feature && !line.toLowerCase().includes(input.feature.toLowerCase())) continue;
    if (input.search_term && !line.toLowerCase().includes(input.search_term.toLowerCase())) continue;
    results.push({
      file: line.substring(root.length + 1).split(":")[0],
      type: "request_model",
      snippet: line.substring(root.length + 1),
    });
  }

  const responseModels = grepRepo("struct.*Response.*Codable|struct.*Response.*Decodable", {
    glob: "*.swift",
    maxResults: 100,
  });
  for (const line of responseModels.split("\n").filter(Boolean)) {
    if (input.feature && !line.toLowerCase().includes(input.feature.toLowerCase())) continue;
    if (input.search_term && !line.toLowerCase().includes(input.search_term.toLowerCase())) continue;
    results.push({
      file: line.substring(root.length + 1).split(":")[0],
      type: "response_model",
      snippet: line.substring(root.length + 1),
    });
  }

  // 3. Find API protocol definitions
  const apiProtocols = grepRepo("protocol\\s+\\w+API", {
    glob: "*.swift",
    maxResults: 100,
  });
  for (const line of apiProtocols.split("\n").filter(Boolean)) {
    if (input.feature && !line.toLowerCase().includes(input.feature.toLowerCase())) continue;
    if (input.search_term && !line.toLowerCase().includes(input.search_term.toLowerCase())) continue;
    results.push({
      file: line.substring(root.length + 1).split(":")[0],
      type: "api_protocol",
      snippet: line.substring(root.length + 1),
    });
  }

  // 4. Find network calls (request method invocations)
  const networkCalls = grepRepo("\\.request\\(|networkAdapter\\.|requestPublisher\\(|performRequest\\(", {
    glob: "*.swift",
    maxResults: 100,
  });
  for (const line of networkCalls.split("\n").filter(Boolean)) {
    if (input.feature && !line.toLowerCase().includes(input.feature.toLowerCase())) continue;
    if (input.search_term && !line.toLowerCase().includes(input.search_term.toLowerCase())) continue;
    results.push({
      file: line.substring(root.length + 1).split(":")[0],
      type: "network_call",
      snippet: line.substring(root.length + 1),
    });
  }

  // Deduplicate and format
  const seen = new Set<string>();
  const unique = results.filter((r) => {
    const key = r.snippet;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) {
    return `No API endpoints found${input.feature ? ` for feature "${input.feature}"` : ""}${input.search_term ? ` matching "${input.search_term}"` : ""}.`;
  }

  const output: string[] = [
    `# API Endpoints${input.feature ? ` — ${input.feature}` : ""}${input.search_term ? ` (filter: "${input.search_term}")` : ""}`,
    `Found ${unique.length} results:\n`,
  ];

  // Group by type
  const byType = new Map<string, ApiEndpoint[]>();
  for (const r of unique) {
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type)!.push(r);
  }

  const typeLabels: Record<string, string> = {
    url_path: "URL Paths / Routes",
    request_model: "Request Models (Encodable)",
    response_model: "Response Models (Decodable)",
    api_protocol: "API Protocol Definitions",
    network_call: "Network Call Sites",
  };

  for (const [type, items] of byType) {
    output.push(`\n## ${typeLabels[type] || type} (${items.length})`);
    for (const item of items.slice(0, 30)) {
      output.push(`  ${item.snippet}`);
    }
    if (items.length > 30) {
      output.push(`  ... and ${items.length - 30} more`);
    }
  }

  return output.join("\n");
}
