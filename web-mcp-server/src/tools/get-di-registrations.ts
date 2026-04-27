import { z } from "zod";
import { grepRepo, getRepoRoot } from "../repo.js";

export const getDiRegistrationsSchema = z.object({
  filter: z.string().optional().describe("Optional feature filter, e.g. 'auth', 'lending'."),
});

export type GetDiRegistrationsInput = z.infer<typeof getDiRegistrationsSchema>;

export async function getDiRegistrations(input: GetDiRegistrationsInput): Promise<string> {
  const root = getRepoRoot();

  function processLines(raw: string): string[] {
    return raw.split("\n").filter(Boolean)
      .map((l) => (l.startsWith(root) ? l.substring(root.length + 1) : l))
      .filter((l) => !l.includes("node_modules") && !l.includes("/dist/"))
      .filter((l) => !input.filter || l.toLowerCase().includes(input.filter.toLowerCase()));
  }

  const definitions = processLines(grepRepo("createContext", { glob: "*.{ts,tsx}", maxResults: 100 }));
  const providers = processLines(grepRepo("\\.Provider", { glob: "*.{ts,tsx}", maxResults: 100, caseSensitive: true }));
  const consumers = processLines(grepRepo("useContext\\s*\\(", { glob: "*.{ts,tsx}", maxResults: 150 }));

  const total = definitions.length + providers.length + consumers.length;
  if (total === 0) {
    return `No React context patterns found${input.filter ? ` for "${input.filter}"` : ""}. Try search_code with 'createContext'.`;
  }

  const out: string[] = [`# React Context / DI Patterns${input.filter ? ` — ${input.filter}` : ""}\n`];

  if (definitions.length) {
    out.push(`## Context Definitions — createContext() (${definitions.length})\n`);
    out.push(...definitions);
    out.push("");
  }
  if (providers.length) {
    out.push(`## Context Providers — .Provider (${providers.length})\n`);
    out.push(...providers);
    out.push("");
  }
  if (consumers.length) {
    out.push(`## Context Consumers — useContext() (${consumers.length})\n`);
    out.push(...consumers);
  }

  return out.join("\n");
}
