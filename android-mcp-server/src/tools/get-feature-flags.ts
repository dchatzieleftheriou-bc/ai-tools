/**
 * Tool: get_feature_flags
 * Discovers feature flags defined and used across the Android codebase.
 */
import { z } from "zod";
import { grepRepo, getRepoRoot } from "../repo.js";

export const getFeatureFlagsSchema = z.object({
  filter: z.string().optional().describe('Optional filter, e.g. "earn", "trade", "kyc".'),
});

export type GetFeatureFlagsInput = z.infer<typeof getFeatureFlagsSchema>;

export async function getFeatureFlags(input: GetFeatureFlagsInput): Promise<string> {
  const root = getRepoRoot();

  // 1. Find FeatureFlag implementations
  const flagImpls = grepRepo("FeatureFlag|IntegratedFeatureFlag|LocalOnlyFeatureFlag|RemoteFeatureFlag", {
    glob: "*.kt",
    maxResults: 300,
    caseSensitive: true,
  });

  const flagLines: string[] = [];
  for (const line of flagImpls.split("\n").filter(Boolean)) {
    if (input.filter && !line.toLowerCase().includes(input.filter.toLowerCase())) continue;
    flagLines.push(line.substring(root.length + 1));
  }

  // 2. Find feature flag key definitions (string constants)
  const flagKeys = grepRepo("remoteConfig_|feature_flag_|ff_|featureFlag", {
    glob: "*.kt",
    maxResults: 200,
    caseSensitive: false,
  });

  const keyLines: string[] = [];
  for (const line of flagKeys.split("\n").filter(Boolean)) {
    if (input.filter && !line.toLowerCase().includes(input.filter.toLowerCase())) continue;
    keyLines.push(line.substring(root.length + 1));
  }

  // 3. Find coEnabled() / enabled usages
  const usages = grepRepo("\\.coEnabled\\(\\)|\\.enabled\\b", {
    glob: "*.kt",
    maxResults: 200,
  });

  const usageLines: string[] = [];
  for (const line of usages.split("\n").filter(Boolean)) {
    if (input.filter && !line.toLowerCase().includes(input.filter.toLowerCase())) continue;
    usageLines.push(line.substring(root.length + 1));
  }

  const total = flagLines.length + keyLines.length + usageLines.length;
  if (total === 0) {
    return `No feature flags found${input.filter ? ` matching "${input.filter}"` : ""}.`;
  }

  const output: string[] = [
    `# Feature Flags${input.filter ? ` (filter: "${input.filter}")` : ""}`,
    `Found ${total} results:\n`,
  ];

  if (flagLines.length > 0) {
    output.push(`\n## Flag Definitions (${flagLines.length})`);
    for (const l of flagLines.slice(0, 40)) output.push(`  ${l}`);
    if (flagLines.length > 40) output.push(`  ... and ${flagLines.length - 40} more`);
  }

  if (keyLines.length > 0) {
    output.push(`\n## Flag Key Constants (${keyLines.length})`);
    for (const l of keyLines.slice(0, 30)) output.push(`  ${l}`);
    if (keyLines.length > 30) output.push(`  ... and ${keyLines.length - 30} more`);
  }

  if (usageLines.length > 0) {
    output.push(`\n## Flag Usage Sites (${usageLines.length})`);
    for (const l of usageLines.slice(0, 30)) output.push(`  ${l}`);
    if (usageLines.length > 30) output.push(`  ... and ${usageLines.length - 30} more`);
  }

  return output.join("\n");
}
