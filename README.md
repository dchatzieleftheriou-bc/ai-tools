# ai-tools

A collection of AI-powered tools that help our mobile teams work in harmony across platforms. Each tool is an [MCP](https://modelcontextprotocol.io) server that plugs into Claude Code, Cursor, Windsurf, or any MCP-compatible client — giving developers a conversational interface to explore, search, and understand code across team boundaries.

## Available Tools

### [ios-mcp-server](./ios-mcp-server)

Gives developers (or anyone outside the iOS team) structured access to the iOS codebase. Auto-clones the repo, caches it locally, and exposes 11 tools for exploring modules, extracting feature logic, data models, navigation flows, DI registrations, searching code, mapping dependencies, and discovering API endpoints — all without opening Xcode.

[Setup guide](./ios-mcp-server/README.md) · [wallet-ios reference](./ios-mcp-server/docs/WALLET-IOS.md)

## Getting Started

Each tool is a self-contained npm package. To install one:

```bash
cd <tool-directory>
npm install && npm run build
npm link
```

`npm link` registers the tool as a global command on your machine — no npm publishing required. After linking, add the MCP config to your editor (Claude Code, Cursor, etc.) and you're good to go. See each tool's README for the exact config.

## Contributing

To add a new tool, create a directory at the root (e.g. `android-mcp-server/`, `backend-mcp-server/`), implement the MCP server, add a README, and update this file.
