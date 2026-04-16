/**
 * Tool: get_feature_flags
 * Discovers feature flags defined and used in the codebase via BlockchainNamespace.
 */
import { z } from "zod";
import { grepRepo, getRepoRoot } from "../repo.js";

export const getFeatureFlagsSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe(
      'Optional filter to narrow results, e.g. "trade", "kyc", "swap", "earn". Searches flag keys and usage context.'
    ),
});

export type GetFeatureFlagsInput = z.infer<typeof getFeatureFlagsSchema>;

export async function getFeatureFlags(input: GetFeatureFlagsInput): Promise<string> {
  const root = getRepoRoot();

  // Search for namespace key definitions
  const keyDefs = grepRepo("blockchain\\.(ux|app|api|db)\\.[a-z._]+", {
    glob: "*.swift",
    maxResults: 500,
    caseSensitive: true,
  });

  // Parse unique keys
  const keySet = new Set<string>();
  const keyUsages: Map<string, string[]> = new Map();

  for (const line of keyDefs.split("\n").filter(Boolean)) {
    const matches = line.matchAll(/blockchain\.(ux|app|api|db)\.[a-z._]+/g);
    for (const m of matches) {
      const key = m[0];
      if (input.filter && !key.includes(input.filter.toLowerCase()) &&
          !line.toLowerCase().includes(input.filter.toLowerCase())) {
        continue;
      }
      keySet.add(key);
      const relFile = line.substring(root.length + 1).split(":")[0];
      if (!keyUsages.has(key)) keyUsages.set(key, []);
      const usages = keyUsages.get(key)!;
      if (!usages.includes(relFile) && usages.length < 5) {
        usages.push(relFile);
      }
    }
  }

  // Also search for is.enabled patterns (common for feature flags)
  const enabledFlags = grepRepo("is[._]enabled|is\\.disabled", {
    glob: "*.swift",
    maxResults: 200,
  });

  const flagLines: string[] = [];
  for (const line of enabledFlags.split("\n").filter(Boolean)) {
    if (input.filter && !line.toLowerCase().includes(input.filter.toLowerCase())) continue;
    const relLine = line.substring(root.length + 1);
    flagLines.push(relLine);
  }

  // Build output
  const output: string[] = [
    `# Feature Flags${input.filter ? ` (filter: "${input.filter}")` : ""}`,
    `Found ${keySet.size} unique namespace keys.\n`,
  ];

  // Group by top-level namespace
  const grouped = new Map<string, string[]>();
  for (const key of [...keySet].sort()) {
    const prefix = key.split(".").slice(0, 3).join(".");
    if (!grouped.has(prefix)) grouped.set(prefix, []);
    grouped.get(prefix)!.push(key);
  }

  for (const [prefix, keys] of [...grouped.entries()].sort()) {
    output.push(`\n## ${prefix}.*`);
    for (const key of keys.slice(0, 20)) {
      const usages = keyUsages.get(key) || [];
      output.push(`  - \`${key}\``);
      if (usages.length > 0) {
        output.push(`    Used in: ${usages.join(", ")}`);
      }
    }
    if (keys.length > 20) {
      output.push(`  ... and ${keys.length - 20} more`);
    }
  }

  if (flagLines.length > 0) {
    output.push(`\n## Enabled/Disabled checks (${flagLines.length})`);
    for (const line of flagLines.slice(0, 30)) {
      output.push(`  ${line}`);
    }
  }

  return output.join("\n");
}
