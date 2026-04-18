# android-mcp-server

An MCP server that gives AI assistants structured, read-only access to an Android codebase. Built for cross-platform teams — iOS developers, backend engineers, or anyone who needs to understand Android/Kotlin code without navigating Android Studio.

Point it at a git repo URL and it handles cloning, caching, and syncing automatically.

## Install

```bash
cd android-mcp-server
npm install && npm run build
npm link
```

## Editor Setup

### Claude Code

Add to `~/.claude/claude_code_config.json` or your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "wallet-android": {
      "command": "android-mcp-server",
      "args": [
        "--repo-url",
        "git@github.com:org/android-repo.git"
      ]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "wallet-android": {
      "command": "android-mcp-server",
      "args": [
        "--repo-url",
        "git@github.com:org/android-repo.git"
      ]
    }
  }
}
```

### Options

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `--repo-url` | `WALLET_ANDROID_REPO_URL` | — | Git repo URL (clones + caches) |
| `--repo-root` | `WALLET_ANDROID_REPO` | — | Path to existing local checkout |
| `--branch` | `WALLET_ANDROID_BRANCH` | `develop` | Branch to track |
| `--cache-dir` | `WALLET_ANDROID_CACHE` | `~/.wallet-android-mcp/repo` | Cache directory |
| `--auto-sync` | — | off | Pull latest on every server start |

## Tools

### `list_modules`

Lists all Gradle modules with type classification (feature, core, common, payments, etc.) and project dependencies.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filter` | string? | Filter by type or name substring |

### `get_feature`

Deep-dives into a feature module — categorises files as ViewModel, state, intent, model, screen, API, repository, DI, navigation, or test.

| Parameter | Type | Description |
|-----------|------|-------------|
| `feature` | string | Feature name, e.g. `"earn"`, `"lending"`, `"dex"` |
| `include_source` | bool? | Include full source of key files (default: false) |

### `search_code`

Regex code search with context lines. Default file type: `*.kt`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Search pattern (regex supported) |
| `file_pattern` | string? | File glob (default: `"*.kt"`) |
| `context_lines` | number? | Context lines (default: 3) |
| `max_results` | number? | Max matches (default: 50) |
| `case_sensitive` | bool? | Case-sensitive (default: false) |

### `get_architecture`

High-level architecture overview: project structure, module dependency graph, patterns (MVI, Clean Arch, Koin), and tech stack.

| Parameter | Type | Description |
|-----------|------|-------------|
| `section` | enum? | `overview`, `dependencies`, `patterns`, `tech_stack`, or `all` (default) |

### `get_api_endpoints`

Discovers Retrofit interfaces, @GET/@POST endpoints, DTOs, and service wrappers.

| Parameter | Type | Description |
|-----------|------|-------------|
| `feature` | string? | Scope to a feature |
| `search_term` | string? | Additional keyword filter |

### `read_file`

Reads a specific file by relative path with optional line range.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Relative path from repo root |
| `start_line` | number? | Start line (1-based) |
| `end_line` | number? | End line (1-based, max 500 lines) |

### `get_feature_flags`

Discovers FeatureFlag implementations, key constants, and usage sites.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filter` | string? | Filter by domain, e.g. `"earn"`, `"trade"` |

### `get_models`

Extracts data classes, DTOs, sealed interfaces, and enums. Shows field names, types, defaults, and @Serializable annotations.

| Parameter | Type | Description |
|-----------|------|-------------|
| `feature` | string | Feature name |
| `include_enums` | bool? | Include enums (default: true) |
| `include_source` | bool? | Include full source (default: false) |

### `get_navigation_flow`

Traces Compose Navigation: NavHost, route registrations, NavController.navigate() calls, NavigationEvent sealed classes, and @Composable screen inventory.

| Parameter | Type | Description |
|-----------|------|-------------|
| `feature` | string | Feature name |

### `get_di_registrations`

Shows Koin DI registrations: viewModel {}, factory {}, single {}, scoped {}, and named qualifiers.

| Parameter | Type | Description |
|-----------|------|-------------|
| `feature` | string? | Scope to a feature (omit for all) |

### `sync_repo`

Pulls latest changes from the tracked branch, or reports cache status.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | enum? | `sync` or `status` (default: `sync`) |

## Requirements

- Node.js 18+
- Git with SSH access to the target repo
- `ripgrep` (`rg`) recommended for faster search (falls back to `grep`)

## Development

```bash
npm run dev    # Watch mode
npm run build  # One-time build
npm start      # Run the server
```

## Repo-Specific Docs

- [wallet-android-private](./docs/WALLET-ANDROID.md) — architecture notes, use cases, and example prompts for the Blockchain.com Android app
