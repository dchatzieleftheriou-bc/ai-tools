# ai-tools

A collection of AI-powered tools that help our mobile teams work in harmony across platforms. Each tool is an [MCP](https://modelcontextprotocol.io) server that plugs into Claude Code, Cursor, Windsurf, or any MCP-compatible client — giving developers a conversational interface to explore, search, and understand code across team boundaries.

## Available Tools

### [ios-mcp-server](./ios-mcp-server)

Gives developers (or anyone outside the iOS team) structured access to the iOS codebase. Auto-clones the repo, caches it locally, and exposes 8 tools for exploring modules, extracting feature logic, searching code, mapping dependencies, and discovering API endpoints — all without opening Xcode.

[Setup guide](./ios-mcp-server/README.md) · [wallet-ios reference](./ios-mcp-server/docs/WALLET-IOS.md)

## Getting Started

Pick a tool from the list above, follow its setup guide, and add the MCP config to your editor. Each tool is self-contained with its own `package.json` and build step.

## Contributing

To add a new tool, create a directory at the root (e.g. `android-mcp-server/`, `backend-mcp-server/`), implement the MCP server, add a README, and update this file.
