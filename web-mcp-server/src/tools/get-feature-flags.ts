import { z } from "zod";
import { grepRepo, getRepoRoot } from "../repo.js";

export const getFeatureFlagsSchema = z.object({
  filter: z.string().optional().describe("Optional filter, e.g. 'trade', 'kyc', 'earn'."),
});

export type GetFeatureFlagsInput = z.infer<typeof getFeatureFlagsSchema>;

export async function getFeatureFlags(input: GetFeatureFlagsInput): Promise<string> {
  const root = getRepoRoot();

  function processLines(raw: string): string[] {
    return raw.split("\n").filter(Boolean)
      .map((l) => (l.startsWith(root) ? l.substring(root.length + 1) : l))
      .filter((l) => !l.includes("node_modules") && !l.includes("generated/"))
      .filter((l) => !input.filter || l.toLowerCase().includes(input.filter.toLowerCase()));
  }

  const firebaseLines = processLines(
    grepRepo("remoteConfig|getBoolean|getValue|getString|fetchAndActivate", {
      glob: "*.{ts,tsx}", maxResults: 200,
    })
  );

  const hookLines = processLines(
    grepRepo("useFeatureFlag|isEnabled|featureFlag|FeatureFlag", {
      glob: "*.{ts,tsx}", maxResults: 200,
    })
  );

  const constLines = processLines(
    grepRepo("FEATURE_FLAG|FEATURE_KEY|ff_|remoteConfig_|flag_", {
      glob: "*.{ts,tsx}", maxResults: 100,
    })
  );

  const total = firebaseLines.length + hookLines.length + constLines.length;
  if (total === 0) {
    return `No feature flags found${input.filter ? ` matching "${input.filter}"` : ""}. Try search_code with 'remoteConfig' or 'featureFlag'.`;
  }

  const out: string[] = [`# Feature Flags${input.filter ? ` — ${input.filter}` : ""}\n`];

  if (constLines.length) {
    out.push(`## Flag Key Definitions (${constLines.length})\n`);
    out.push(...constLines);
    out.push("");
  }
  if (firebaseLines.length) {
    out.push(`## Firebase Remote Config Usage (${firebaseLines.length})\n`);
    out.push(...firebaseLines);
    out.push("");
  }
  if (hookLines.length) {
    out.push(`## Custom Hook / Utility Usage (${hookLines.length})\n`);
    out.push(...hookLines);
  }

  return out.join("\n");
}
