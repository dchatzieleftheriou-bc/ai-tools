import { z } from "zod";
import { repoPath, readTextFile, fileExists } from "../repo.js";

export const readFileSchema = z.object({
  path: z.string().describe('Relative path from repo root, e.g. "src/components/Account/index.tsx"'),
  start_line: z.number().optional(),
  end_line: z.number().optional().describe("Last line to read (inclusive). Defaults to start_line + 500."),
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
  const end = Math.max(input.end_line || Math.min(lines.length, start + 500), start + 1);
  const slice = lines.slice(start, end);
  const numbered = slice.map((line, i) => `${start + i + 1} | ${line}`).join("\n");

  return `# ${input.path}\nLines ${start + 1}–${end} of ${lines.length} total\n\n\`\`\`typescript\n${numbered}\n\`\`\``;
}
