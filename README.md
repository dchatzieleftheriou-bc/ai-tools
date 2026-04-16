# wallet-ios MCP Server

An MCP (Model Context Protocol) server that exposes the **wallet-ios-private** iOS codebase to Android developers. Connect it to Claude Code, Cursor, or any MCP-compatible client to explore iOS features, search code, understand architecture, and discover API endpoints — without needing to know Swift or navigate the iOS project structure.

## Quick Start

```bash
cd mcp-server
npm install
npm run build
```

## Setup Modes

### Mode 1: Repo URL (recommended for Android devs)

Just give it the repo URL — it clones, caches, and keeps things up to date automatically. No need to manually clone the iOS repo.

```bash
node dist/index.js --repo-url git@github.com:blockchain/wallet-ios-private.git
```

The repo is shallow-cloned to `~/.wallet-ios-mcp/repo` on first use (takes ~2 min). Subsequent starts reuse the cache instantly. Use the `sync_repo` tool anytime to pull latest changes from `dev`.

**Options:**
- `--branch <name>` — Branch to track (default: `dev`)
- `--cache-dir <path>` — Custom cache location (default: `~/.wallet-ios-mcp/repo`)
- `--auto-sync` — Automatically pull latest on every server start

### Mode 2: Local checkout

If you already have the iOS repo cloned locally:

```bash
node dist/index.js --repo-root /path/to/wallet-ios-private
```

### Environment variables

All CLI flags have env var equivalents:

| Flag | Env var | Description |
|------|---------|-------------|
| `--repo-url` | `WALLET_IOS_REPO_URL` | Git repo URL |
| `--repo-root` | `WALLET_IOS_REPO` | Path to local checkout |
| `--branch` | `WALLET_IOS_BRANCH` | Branch to track |
| `--cache-dir` | `WALLET_IOS_CACHE` | Cache directory |

## Connecting to AI Tools

### Claude Code

Add to your Claude Code MCP config (`~/.claude/claude_code_config.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "wallet-ios": {
      "command": "node",
      "args": [
        "/path/to/mcp-server/dist/index.js",
        "--repo-url",
        "git@github.com:blockchain/wallet-ios-private.git"
      ]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your Android project:

```json
{
  "mcpServers": {
    "wallet-ios": {
      "command": "node",
      "args": [
        "/path/to/mcp-server/dist/index.js",
        "--repo-url",
        "git@github.com:blockchain/wallet-ios-private.git"
      ]
    }
  }
}
```

### With auto-sync on startup

If you want the server to always pull latest when it starts:

```json
{
  "mcpServers": {
    "wallet-ios": {
      "command": "node",
      "args": [
        "/path/to/mcp-server/dist/index.js",
        "--repo-url",
        "git@github.com:blockchain/wallet-ios-private.git",
        "--auto-sync"
      ]
    }
  }
}
```

## Available Tools

### `list_modules`
List all ~95 iOS modules with type classification (feature, platform, core, etc.), their published products, and internal/external dependencies.

**Example prompts:**
- "List all feature modules in the iOS app"
- "What modules relate to trading?"
- "Show me the platform modules and their dependencies"

### `get_feature`
Deep-dive into a specific feature module. Extracts and categorizes all files into: reducers, state, actions, models, views, API calls, repositories, mocks, and tests. Optionally includes full source code.

**Example prompts:**
- "Show me the Transaction feature architecture"
- "What reducers and state models does the Authentication feature have?"
- "Get the KYC feature with full source code of the reducers"

### `search_code`
Regex-powered code search with configurable context lines. Searches across the entire iOS codebase or filtered by file pattern.

**Example prompts:**
- "Find all usages of OrderCreationRequest"
- "Search for swap-related API calls"
- "Find where blockchain.ux.trade flags are checked"

### `get_architecture`
High-level architecture overview with sections: project structure, module dependency graph, architectural patterns (TCA, Clean Architecture, DI), and technology stack.

**Example prompts:**
- "Explain the iOS app architecture"
- "Show me the module dependency graph"
- "What patterns does the iOS team use for state management?"

### `get_api_endpoints`
Discovers API endpoints, request/response models, API protocol definitions, and network call sites. Scoped by feature or search term.

**Example prompts:**
- "What API endpoints does the Transaction feature call?"
- "Find all request models related to swaps"
- "Show me all API protocol definitions"

### `read_file`
Read any file from the repo by relative path, with optional line range. Use after discovering paths via other tools.

**Example prompts:**
- "Show me the EmailLoginReducer.swift file"
- "Read lines 50-100 of the OrderCreationRequest"

### `get_feature_flags`
Discover feature flags from the BlockchainNamespace system. Shows namespace keys and where they're used across the codebase.

**Example prompts:**
- "What feature flags exist for trading?"
- "Show me all KYC-related feature flags"
- "List the blockchain.ux namespace keys"

### `sync_repo`
Pull latest changes from the `dev` branch, or check current sync status. The cache is preserved across server restarts.

**Example prompts:**
- "Sync the iOS repo to get the latest code"
- "When was the iOS repo cache last updated?"
- "What commit is the iOS repo at?"

## Use Cases for Android Developers

1. **Feature parity** — "I'm building the Swap feature on Android. Show me how iOS implements it so I can match the logic."
2. **API discovery** — "What endpoints does the iOS Trade feature call? I need to integrate the same APIs."
3. **Business logic extraction** — "Show me the reducer for Order Creation — I need to replicate the state machine."
4. **Architecture reference** — "How does iOS handle dependency injection? I want to compare with our Dagger setup."
5. **Feature flag alignment** — "What feature flags control the Earn product? We need the same gates on Android."
6. **Stay in sync** — "Sync the iOS repo and show me what changed in the Transaction module recently."

## Requirements

- Node.js 18+
- Git (with SSH key configured for `git@github.com:blockchain/wallet-ios-private.git`)
- `ripgrep` (`rg`) recommended for faster search (falls back to `grep`)

## Development

```bash
npm run dev    # Watch mode — recompiles on changes
npm run build  # One-time build
npm start      # Run the server
```
