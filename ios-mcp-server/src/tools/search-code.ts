/**
 * Tool: search_code
 * Smart code search with context — searches the iOS codebase and returns
 * matches with surrounding context and file classification.
 */
import { z } from "zod";
import { grepRepo, getRepoRoot, relPath, readTextFile, repoPath } from "../repo.js";

export const searchCodeSchema = z.object({
  query: z
    .string()
    .describe("Search pattern (regex supported). E.g. 'OrderCreationRequest', 'func.*swap', 'blockchain\\.ux\\.trade'."),
  file_pattern: z
    .string()
    .optional()
    .describe("File glob pattern, e.g. '*.swift', '*.json'. Default: '*.swift'"),
  context_lines: z
    .number()
    .optional()
    .default(3)
    .describe("Number of context lines around each match. Default: 3"),
  max_results: z
    .number()
    .optional()
    .default(50)
    .describe("Max number of matching lines to return. Default: 50"),
  case_sensitive: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether search is case-sensitive. Default: false"),
});

export type SearchCodeInput = z.infer<typeof searchCodeSchema>;

export async function searchCode(input: SearchCodeInput): Promise<string> {
  const results = grepRepo(input.query, {
    glob: input.file_pattern || "*.swift",
    maxResults: input.max_results,
    contextLines: input.context_lines,
    caseSensitive: input.case_sensitive,
  });

  if (!results.trim()) {
    return `No matches found for pattern: "${input.query}" in ${input.file_pattern || "*.swift"} files.`;
  }

  // Post-process: make paths relative
  const root = getRepoRoot();
  const processed = results
    .split("\n")
    .map((line) => {
      if (line.startsWith(root)) {
        return line.substring(root.length + 1);
      }
      return line;
    })
    .join("\n");

  const matchCount = processed.split("\n").filter((l) => l.match(/^\S.*:\d+:/)).length;

  return `Found ~${matchCount} matches for "${input.query}":\n\n${processed}`;
}
