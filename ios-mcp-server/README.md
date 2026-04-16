# ios-mcp-server

An MCP server that gives AI assistants structured, read-only access to an iOS codebase. Built for cross-platform teams — Android developers, backend engineers, or anyone who needs to understand iOS code without navigating Xcode.

Point it at a git repo URL and it handles cloning, caching, and syncing automatically.

## Install

```bash
cd ios-mcp-server
npm install && npm run build
npm link
```

`npm link` registers the `ios-mcp-server` command globally on your machine — no publishing required.

## Editor Setup

After linking, the MCP config is just:

### Claude Code

Add to `~/.claude/claude_code_config.json` or your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "wallet-ios": {
      "command": "ios-mcp-server",
      "args": [
        "--repo-url",
        "git@github.com:org/ios-repo.git"
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
    "wallet-ios": {
      "command": "ios-mcp-server",
      "args": [
        "--repo-url",
        "git@github.com:org/ios-repo.git"
      ]
    }
  }
}
```

### Options

Pass these as additional args or set as environment variables:

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `--repo-url` | `WALLET_IOS_REPO_URL` | — | Git repo URL (clones + caches) |
| `--repo-root` | `WALLET_IOS_REPO` | — | Path to existing local checkout |
| `--branch` | `WALLET_IOS_BRANCH` | `dev` | Branch to track |
| `--cache-dir` | `WALLET_IOS_CACHE` | `~/.wallet-ios-mcp/repo` | Cache directory |
| `--auto-sync` | — | off | Pull latest on every server start |

## Tools

### `list_modules`

Lists all Swift Package Manager modules with type classification (feature, platform, core, etc.), published products, and dependency info.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filter` | string? | Filter by type (`feature`, `platform`, `core`) or name substring |

### `get_feature`

Deep-dives into a feature module — categorises every file as reducer, state, action, model, view, API call, repository, mock, or test. Optionally returns full source code.

| Parameter | Type | Description |
|-----------|------|-------------|
| `feature` | string | Feature name, e.g. `"Authentication"`, `"Transaction"` |
| `include_source` | bool? | Include full source of key files (default: false) |

### `search_code`

Regex code search with context lines across the entire codebase.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Search pattern (regex supported) |
| `file_pattern` | string? | File glob, e.g. `"*.swift"` (default: `"*.swift"`) |
| `context_lines` | number? | Lines of context around matches (default: 3) |
| `max_results` | number? | Max matching lines (default: 50) |
| `case_sensitive` | bool? | Case-sensitive search (default: false) |

### `get_architecture`

Returns a high-level architecture overview: project structure, module dependency graph, architectural patterns, and technology stack.

| Parameter | Type | Description |
|-----------|------|-------------|
| `section` | enum? | `overview`, `dependencies`, `patterns`, `tech_stack`, or `all` (default) |

### `get_api_endpoints`

Discovers API routes, request/response models, protocol definitions, and network call sites.

| Parameter | Type | Description |
|-----------|------|-------------|
| `feature` | string? | Scope to a feature module |
| `search_term` | string? | Additional keyword filter |

### `read_file`

Reads a specific file by relative path with optional line range.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Relative path from repo root |
| `start_line` | number? | Start line (1-based) |
| `end_line` | number? | End line (1-based, max 500 lines) |

### `get_feature_flags`

Discovers feature flags from the namespace system — keys, where they're defined, and where they're used.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filter` | string? | Filter by domain, e.g. `"trade"`, `"kyc"` |

### `get_models`

Extracts data models, DTOs, request/response structs, and enums for a feature. Shows field names, types, optionality, CodingKeys, and protocol conformances — everything needed to build the Kotlin data classes.

| Parameter | Type | Description |
|-----------|------|-------------|
| `feature` | string | Feature name, e.g. `"Transaction"`, `"KYC"` |
| `include_enums` | bool? | Include enum definitions (default: true) |
| `include_source` | bool? | Include full Swift source of each model (default: false) |

### `get_navigation_flow`

Traces how screens connect within a feature. Finds NavigationLinks, sheets, full screen covers, TCA Destination enums, deep links, router calls, and app events. Lists all View structs as a screen inventory.

| Parameter | Type | Description |
|-----------|------|-------------|
| `feature` | string | Feature name, e.g. `"Authentication"`, `"Transaction"` |

### `get_di_registrations`

Shows dependency injection registrations — both DIKit (factory/single with tags) and swift-dependencies (@Dependency, DependencyKey, liveValue). Helps map what's a singleton vs factory when building the Hilt/Dagger equivalent.

| Parameter | Type | Description |
|-----------|------|-------------|
| `feature` | string? | Scope to a feature (omit to see all) |
| `system` | enum? | `dikit`, `dependencies`, or `all` (default) |

### `sync_repo`

Pulls latest changes from the tracked branch, or reports current cache status.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | enum? | `sync` (pull latest) or `status` (check cache state). Default: `sync` |

## Requirements

- Node.js 18+
- Git with SSH access to the target repo
- `ripgrep` (`rg`) recommended for faster search (falls back to `grep`)

## Development

```bash
npm run dev    # Watch mode — recompiles on changes
npm run build  # One-time build
npm start      # Run the server
```

## Repo-Specific Docs

- [wallet-ios-private](./docs/WALLET-IOS.md) — architecture notes, use cases, and example prompts for the Blockchain.com iOS app
