/**
 * Tool: read_file
 * Read a specific file from the iOS repo. Useful when an Android dev
 * wants to see the exact implementation of a file discovered via other tools.
 */
import { z } from "zod";
import { repoPath, readTextFile, fileExists, relPath } from "../repo.js";

export const readFileSchema = z.object({
  path: z
    .string()
    .describe(
      'Relative path from repo root, e.g. "Modules/FeatureAuthentication/Sources/FeatureAuthenticationUI/EmailLogin/EmailLoginReducer.swift"'
    ),
  start_line: z
    .number()
    .optional()
    .describe("Optional start line (1-based). If omitted, reads from beginning."),
  end_line: z
    .number()
    .optional()
    .describe("Optional end line (1-based). If omitted, reads to end (max 500 lines)."),
});

export type ReadFileInput = z.infer<typeof readFileSchema>;

export async function readRepoFile(input: ReadFileInput): Promise<string> {
  const fullPath = repoPath(input.path);

  if (!(await fileExists(fullPath))) {
    return `File not found: ${input.path}\n\nHint: Use search_code or get_feature to discover file paths.`;
  }

  const content = await readTextFile(fullPath);
  const lines = content.split("\n");

  const start = (input.start_line || 1) - 1;
  const end = input.end_line || Math.min(lines.length, start + 500);
  const slice = lines.slice(start, end);

  const numbered = slice.map((line, i) => `${start + i + 1} | ${line}`).join("\n");

  const header = `# ${input.path}`;
  const meta = `Lines ${start + 1}–${end} of ${lines.length} total`;

  return `${header}\n${meta}\n\n\`\`\`swift\n${numbered}\n\`\`\``;
}
