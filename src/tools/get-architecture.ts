/**
 * Tool: get_architecture
 * Returns a high-level architecture overview of the iOS app, including
 * module dependency graph, key patterns, and technology stack.
 */
import { z } from "zod";
import {
  repoPath,
  listDir,
  isDirectory,
  readTextFile,
  fileExists,
} from "../repo.js";
import { join } from "path";

export const getArchitectureSchema = z.object({
  section: z
    .enum(["overview", "dependencies", "patterns", "tech_stack", "all"])
    .optional()
    .default("all")
    .describe("Which section to return. Default: 'all'."),
});

export type GetArchitectureInput = z.infer<typeof getArchitectureSchema>;

async function buildDependencyGraph(): Promise<
  Map<string, { internal: string[]; external: string[]; products: string[] }>
> {
  const modulesDir = repoPath("Modules");
  const entries = await listDir(modulesDir);
  const graph = new Map<
    string,
    { internal: string[]; external: string[]; products: string[] }
  >();

  for (const entry of entries) {
    const pkgPath = join(modulesDir, entry, "Package.swift");
    if (!(await fileExists(pkgPath))) continue;

    const content = await readTextFile(pkgPath);

    const products = [...content.matchAll(/\.library\(\s*name:\s*"([^"]+)"/g)].map(
      (m) => m[1]
    );

    const internal: string[] = [];
    const external: string[] = [];

    const deps = [...content.matchAll(/\.package\((.*?)\)/gs)];
    for (const d of deps) {
      const line = d[1];
      if (line.includes("path:")) {
        const m = line.match(/path:\s*"([^"]+)"/);
        if (m) internal.push(m[1].split("/").pop() || m[1]);
      } else if (line.includes("url:")) {
        const m = line.match(/url:\s*"([^"]+)"/);
        if (m) external.push(m[1].split("/").pop()?.replace(".git", "") || m[1]);
      }
    }

    graph.set(entry, { internal, external, products });
  }

  return graph;
}

function getOverview(): string {
  return `# iOS Wallet Architecture Overview

## Project Structure
- **Monorepo** with ~95 Swift Package Manager (SPM) modules under /Modules
- **Main app target** in /Blockchain (entry point, DI assembly, app delegate)
- **XcodeGen** generates the Xcode project from project.yml
- **5 build environments**: Dev, Staging, Alpha, Internal Production, Production

## Module Organization
Modules follow a strict naming convention:
- **Feature{Name}** — Product feature modules (Authentication, Transaction, KYC, etc.)
  - Often split into: {Name}Domain, {Name}Data, {Name}UI, {Name}Mock
- **Platform** — Cross-cutting services (PlatformKit, PlatformUIKit)
- **Coincore** — Core cryptocurrency abstraction (accounts, assets, transactions)
- **Network/NetworkKit** — HTTP networking layer
- **BlockchainNamespace** — Strongly-typed feature flag / app state system
- **BlockchainComponentLibrary / UIComponents** — Shared design system
- **WalletPayload / WalletCore** — Wallet data model and crypto operations

## Data Flow
1. **Views** (SwiftUI) observe TCA Store
2. **Reducers** handle actions, produce effects
3. **Effects** call domain services/repositories
4. **Repositories** call network layer or local storage
5. **Network layer** handles HTTP, auth, retry logic

## Entry Points for Android Developers
- Start with a Feature module to understand a specific product area
- Look at {Feature}Domain for business logic and models
- Look at {Feature}Data for API integration patterns
- The Reducer files contain the core state machine logic
`;
}

function getPatterns(): string {
  return `# Key Architectural Patterns

## 1. The Composable Architecture (TCA)
- Primary UI/state pattern (pointfreeco/swift-composable-architecture v1.25.2)
- Features modeled as Reducers with State, Action, and Effect
- Pattern:
  \`\`\`swift
  @Reducer
  struct MyFeatureReducer {
      struct State: Equatable { ... }
      enum Action { ... }
      var body: some Reducer<State, Action> {
          Reduce { state, action in
              switch action { ... }
          }
      }
  }
  \`\`\`

## 2. Clean Architecture Layers
- **Domain**: Protocols (*API suffix), DTOs, use cases
- **Data**: Concrete repository implementations, network clients
- **UI**: SwiftUI views + TCA reducers
- **Mock**: Test doubles for each layer

## 3. Dependency Injection (DIKit)
- Custom DI container (blockchain/DIKit v1.0.1)
- Registrations in /Blockchain/DIKit/ assembly files
- Uses: factory (new instance), single (singleton), with optional tag

## 4. Reactive Streams
- RxSwift for domain/data layer async operations
- Combine publishers for newer code
- TCA Effects bridge between reactive streams and state updates

## 5. Protocol-First Design
- All services defined as protocols with *API suffix
- e.g. CardListRepositoryAPI, WalletConnectServiceAPI
- Concrete implementations in Data layer
- Mock implementations in Mock targets

## 6. Feature Flags (BlockchainNamespace)
- Typed key-value namespace: blockchain.ux.*, blockchain.app.*
- Values from Firebase Remote Config or local overrides
- Checked via app.state.get() / app.state.set()
`;
}

function getTechStack(): string {
  return `# Technology Stack

## Languages & Versions
- **Swift 5.10** (.swiftversion)
- **iOS 17.0** deployment target (newer modules); iOS 15.0 (older modules)
- **Xcode 15+** required

## Core Frameworks
- **SwiftUI** — Primary UI framework
- **UIKit** — Legacy screens (PlatformUIKit)
- **Combine** — Apple's reactive framework
- **RxSwift 6.8+** — Reactive extensions (domain/data layers)

## Architecture
- **TCA (swift-composable-architecture) v1.25.2** — State management
- **swift-dependencies v1.7+** — Dependency injection (TCA-style)
- **DIKit v1.0.1** — Legacy DI container

## Networking
- **Custom NetworkKit** — In-house HTTP layer
- **WebSocket** support
- **Certificate pinning**

## Build & CI
- **XcodeGen** — Generates .xcodeproj from project.yml
- **Fastlane** — Build, test, distribute
- **SwiftLint + SwiftFormat** — Code style enforcement
- **Git LFS** — Large binary assets

## Testing
- **XCTest** — Unit testing
- **Snapshot testing** (SnapshotTestsHostApp)
- **Maestro** — UI/E2E testing
- Mock targets for every module
`;
}

export async function getArchitecture(input: GetArchitectureInput): Promise<string> {
  const sections: string[] = [];
  const section = input.section;

  if (section === "all" || section === "overview") {
    sections.push(getOverview());
  }

  if (section === "all" || section === "patterns") {
    sections.push(getPatterns());
  }

  if (section === "all" || section === "tech_stack") {
    sections.push(getTechStack());
  }

  if (section === "all" || section === "dependencies") {
    const graph = await buildDependencyGraph();
    const lines: string[] = ["# Module Dependency Graph\n"];

    // Find most-depended-on modules
    const depCount = new Map<string, number>();
    for (const [, info] of graph) {
      for (const dep of info.internal) {
        depCount.set(dep, (depCount.get(dep) || 0) + 1);
      }
    }
    const sorted = [...depCount.entries()].sort((a, b) => b[1] - a[1]);

    lines.push("## Most depended-on modules:");
    for (const [name, count] of sorted.slice(0, 20)) {
      lines.push(`  - ${name}: used by ${count} modules`);
    }

    lines.push("\n## Full dependency list:");
    for (const [name, info] of [...graph.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      lines.push(`\n### ${name}`);
      lines.push(`  Products: ${info.products.join(", ") || "(none)"}`);
      if (info.internal.length)
        lines.push(`  Internal deps: ${info.internal.join(", ")}`);
      if (info.external.length)
        lines.push(`  External deps: ${info.external.join(", ")}`);
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n---\n\n");
}
