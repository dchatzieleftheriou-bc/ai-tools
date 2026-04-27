import { z } from "zod";
import { repoPath, readTextFile, fileExists, grepRepo, getRepoRoot } from "../repo.js";

export const getTranslationsSchema = z.object({
  filter: z.string().optional().describe("Optional filter, e.g. 'lending', 'kyc', 'earn'."),
});

export type GetTranslationsInput = z.infer<typeof getTranslationsSchema>;

export async function getTranslations(input: GetTranslationsInput): Promise<string> {
  const root = getRepoRoot();
  const translationsPath = repoPath("src", "global.translations.ts");

  let keys: string[] = [];
  if (await fileExists(translationsPath)) {
    const content = await readTextFile(translationsPath);
    const matches = content.matchAll(/['"]([a-z][a-z0-9._-]{3,})['"]/gi);
    for (const m of matches) {
      const key = m[1];
      if (!input.filter || key.toLowerCase().includes(input.filter.toLowerCase())) {
        keys.push(key);
      }
    }
    keys = [...new Set(keys)].sort();
  }

  const usagePatterns = [
    { pattern: "intl\\.formatMessage\\(", label: "intl.formatMessage()" },
    { pattern: "useIntl\\b", label: "useIntl()" },
    { pattern: "FormattedMessage", label: "<FormattedMessage>" },
    { pattern: "defineMessages", label: "defineMessages()" },
  ];

  const out: string[] = [`# Translations${input.filter ? ` — ${input.filter}` : ""}\n`];

  if (keys.length > 0) {
    out.push(`## Translation Keys (${keys.length})\n`);
    for (const k of keys.slice(0, 200)) out.push(`  ${k}`);
    if (keys.length > 200) out.push(`  ... and ${keys.length - 200} more`);
    out.push("");
  } else {
    out.push(`## Translation Keys\n  (${(await fileExists(translationsPath)) ? "No matching keys found" : "src/global.translations.ts not found"})\n`);
  }

  out.push("## Usage Sites\n");
  for (const { pattern, label } of usagePatterns) {
    const raw = grepRepo(pattern, { glob: "*.{ts,tsx}", maxResults: 100 });
    const lines = raw.split("\n").filter(Boolean)
      .map((l) => (l.startsWith(root) ? l.substring(root.length + 1) : l))
      .filter((l) => !l.includes("node_modules"))
      .filter((l) => !input.filter || l.toLowerCase().includes(input.filter.toLowerCase()));

    if (lines.length > 0) {
      out.push(`### ${label} (${lines.length})\n`);
      out.push(...lines);
      out.push("");
    }
  }

  return out.join("\n");
}
