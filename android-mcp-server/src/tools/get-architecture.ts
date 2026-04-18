/**
 * Tool: get_architecture
 * High-level architecture overview of the Android app.
 */
import { z } from "zod";
import { repoPath, readTextFile, fileExists, listDir, isDirectory } from "../repo.js";
import { join } from "path";

export const getArchitectureSchema = z.object({
  section: z
    .enum(["overview", "dependencies", "patterns", "tech_stack", "all"])
    .optional()
    .default("all"),
});

export type GetArchitectureInput = z.infer<typeof getArchitectureSchema>;

function getOverview(): string {
  return `# Android Wallet Architecture Overview

## Project Structure
- **Multi-module Gradle project** with ~84 modules
- **Main app module** in /app (entry point, Koin DI startup)
- **Clean Architecture** with domain/data/presentation layering per feature
- **Build environments**: Debug, Staging, Production

## Module Organization
Modules follow a strict naming convention:
- **Feature modules** — Top-level dirs with domain/data/presentation sub-modules (earn, lending, dex, etc.)
- **Flow modules** — Screen flows: flowhome, flowprices, flowtransactions, flowlogin
- **Core modules** — core, coreandroid, coincore, balance, wallet
- **Common modules** — common:interface, common:network, common:domain, common:presentation, common:navigation
- **API layer** — blockchainApi (all Retrofit interfaces and DTOs)
- **Shared UI** — componentlib, componentlib-icons (design system)
- **Payments** — payments:core, payments:stripe, payments:checkoutcom, payments:googlepay
- **Storage** — store:core, store:caches (SqlDelight, in-memory)

## Data Flow
1. **Composable screens** observe ViewModel state
2. **ViewModels** (MviViewModel) process intents, update model state → view state
3. **Use cases / Repositories** in domain layer define business logic interfaces
4. **Data layer** implements repositories using Retrofit services + local caches
5. **blockchainApi** module contains all Retrofit interface definitions + DTOs

## Entry Points for iOS Developers
- Start with a feature's \`presentation\` module for screens and ViewModels
- Look at \`domain\` for business logic interfaces and models
- Look at \`data\` for API integration and repository implementations
- The ViewModel files contain the core state machine logic (intents → state)
`;
}

function getPatterns(): string {
  return `# Key Architectural Patterns

## 1. MVI (Model-View-Intent)
- Primary pattern via \`MviViewModel<Intent, ViewState, ModelState, Navigation>\`
- **Intent**: User actions / events (sealed interface)
- **ModelState**: Internal state (data class)
- **ViewState**: UI-facing state derived from ModelState
- **Navigation**: Side effects for navigation (sealed interface)

## 2. Clean Architecture Layers
- **domain/**: Interfaces, use cases, models (pure Kotlin, no Android deps)
- **data/**: Repository implementations, Retrofit services, mappers
- **presentation/**: ViewModels, Composable screens, navigation

## 3. Dependency Injection (Koin)
- Koin module DSL: \`module { viewModel { ... }, factory { ... }, scoped { ... } }\`
- Modules registered in /app KoinStarter
- Feature modules declare their own Koin modules

## 4. Reactive Streams
- **Kotlin Coroutines + Flow** for newer code
- **RxJava (Single, Observable)** for legacy code
- **Outcome<Exception, T>** result wrapper for suspend functions

## 5. Retrofit API Layer
- All API interfaces in /blockchainApi with @GET/@POST annotations
- Service wrappers convert Retrofit calls to Outcome or Single
- DTOs annotated with @Serializable (kotlinx.serialization)

## 6. Compose UI
- Jetpack Compose for all new screens
- Material 3 theming via componentlib
- Navigation via Compose NavHost + NavController
`;
}

function getTechStack(): string {
  return `# Technology Stack

## Languages & Versions
- **Kotlin** — Primary language
- **Java** — Legacy code only
- **Min SDK**: varies per module

## Core Frameworks
- **Jetpack Compose** — UI framework
- **Material 3** — Design system (via componentlib)
- **Kotlin Coroutines + Flow** — Async / reactive
- **RxJava** — Legacy reactive (migrating to coroutines)

## Architecture
- **MviViewModel** — Custom MVI implementation
- **Koin** — Dependency injection
- **Clean Architecture** — domain/data/presentation per feature

## Networking
- **Retrofit** — HTTP client (interfaces in blockchainApi)
- **OkHttp** — HTTP engine
- **kotlinx.serialization** — JSON serialization

## Storage
- **SqlDelight** — Local database
- **DataStore** — Key-value storage
- **Custom store layer** — store:core with cache strategies

## Build & CI
- **Gradle** — Build system (Kotlin DSL)
- **Fastlane** — Distribution automation

## Testing
- **JUnit** — Unit testing
- **Mockk** — Mocking
- **Turbine** — Flow testing
- **Compose Test** — UI testing
`;
}

async function buildDependencyGraph(): Promise<string> {
  let settingsContent = "";
  for (const filename of ["settings.gradle", "settings.gradle.kts"]) {
    const path = repoPath(filename);
    if (await fileExists(path)) {
      settingsContent = await readTextFile(path);
      break;
    }
  }

  const moduleNames: string[] = [];
  const allQuoted = settingsContent.matchAll(/['"](:[\w:.-]+)['"]/g);
  for (const m of allQuoted) {
    const name = m[1].replace(/^:/, "");
    if (!moduleNames.includes(name)) moduleNames.push(name);
  }

  const depCount = new Map<string, number>();
  const moduleInfo: { name: string; deps: string[] }[] = [];

  for (const name of moduleNames) {
    const path = name.replace(/:/g, "/");
    const deps: string[] = [];
    for (const filename of ["build.gradle", "build.gradle.kts"]) {
      const buildPath = repoPath(path, filename);
      if (await fileExists(buildPath)) {
        const content = await readTextFile(buildPath);
        const matches = content.matchAll(/project\s*\(\s*["']([^"']+)["']\s*\)/g);
        for (const m of matches) {
          const dep = m[1].replace(/^:/, "");
          deps.push(dep);
          depCount.set(dep, (depCount.get(dep) || 0) + 1);
        }
      }
    }
    moduleInfo.push({ name, deps });
  }

  const sorted = [...depCount.entries()].sort((a, b) => b[1] - a[1]);
  const lines: string[] = ["# Module Dependency Graph\n"];

  lines.push("## Most depended-on modules:");
  for (const [name, count] of sorted.slice(0, 20)) {
    lines.push(`  - :${name}: used by ${count} modules`);
  }

  lines.push("\n## Full dependency list:");
  for (const m of moduleInfo.sort((a, b) => a.name.localeCompare(b.name))) {
    if (m.deps.length === 0) continue;
    lines.push(`\n### :${m.name}`);
    lines.push(`  Depends on: ${m.deps.map((d) => `:${d}`).join(", ")}`);
  }

  return lines.join("\n");
}

export async function getArchitecture(input: GetArchitectureInput): Promise<string> {
  const sections: string[] = [];
  const s = input.section;

  if (s === "all" || s === "overview") sections.push(getOverview());
  if (s === "all" || s === "patterns") sections.push(getPatterns());
  if (s === "all" || s === "tech_stack") sections.push(getTechStack());
  if (s === "all" || s === "dependencies") sections.push(await buildDependencyGraph());

  return sections.join("\n\n---\n\n");
}
