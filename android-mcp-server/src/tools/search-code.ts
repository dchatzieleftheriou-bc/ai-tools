/**
 * Tool: search_code
 * Smart code search across the Android codebase with context.
 */
import { z } from "zod";
import { grepRepo, getRepoRoot } from "../repo.js";

export const searchCodeSchema = z.object({
  query: z.string().describe("Search pattern (regex supported)."),
  file_pattern: z.string().optional().describe("File glob, e.g. '*.kt', '*.xml'. Default: '*.kt'"),
  context_lines: z.number().optional().default(3),
  max_results: z.number().optional().default(50),
  case_sensitive: z.boolean().optional().default(false),
});

export type SearchCodeInput = z.infer<typeof searchCodeSchema>;

export async function searchCode(input: SearchCodeInput): Promise<string> {
  const results = grepRepo(input.query, {
    glob: input.file_pattern || "*.kt",
    maxResults: input.max_results,
    contextLines: input.context_lines,
    caseSensitive: input.case_sensitive,
  });

  if (!results.trim()) {
    return `No matches found for pattern: "${input.query}" in ${input.file_pattern || "*.kt"} files.`;
  }

  const root = getRepoRoot();
  const processed = results.split("\n").map((line) =>
    line.startsWith(root) ? line.substring(root.length + 1) : line
  ).join("\n");

  const matchCount = processed.split("\n").filter((l) => l.match(/^\S.*:\d+:/)).length;
  return `Found ~${matchCount} matches for "${input.query}":\n\n${processed}`;
}
