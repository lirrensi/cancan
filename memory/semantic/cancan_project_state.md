---
summary: "Current purpose, architecture, storage model, and product decisions for the CanCan app"
created: 2026-04-06
updated: 2026-04-06
memory_type: semantic
tags: [code, cancan, kanban, luminka, architecture, ui, markdown]
---

# CanCan Project State

## Purpose

CanCan is a portable local kanban app inspired by the `markdown-kanban` VS Code extension, but packaged as a standalone CLI-launched desktop app. The intended user workflow is to run `cancan` from any folder and have that folder become the active workspace.

## Core Product Idea

- The app is local-first and workspace-local.
- It stores kanban data inside the current working directory.
- The storage model is many boards per workspace.
- Each board is a single markdown file.
- The human user primarily edits through the UI, but the file format remains intentionally readable and editable by agents or by hand.

## Runtime And Shell Decisions

- Runtime library: Luminka.
- Primary runtime mode: `webview`.
- Root behavior: `detached` mode using dynamic current working directory.
- Executable identity: `cancan` / `cancan.exe`.
- Filesystem capability is enabled; scripts and shell are disabled.
- On Windows webview builds, the project currently uses MSYS2 MinGW GCC from `C:\msys64\mingw64\bin\gcc.exe`.

## Storage Layout

- Workspace metadata directory: `.kanban/`
- Board files: `.kanban/boards/<slug>.md`
- App config: `.kanban/config.json`
- Current implementation creates a default `inbox.md` board on first run.

## Board File Format

Each board markdown file supports:

1. Optional YAML-like front matter at the top between `---` markers
2. `# Board Title`
3. Optional board description text between the title and the first column
4. `## Column Name`
5. `### Task Title`
6. Indented task properties like `due`, `tags`, `priority`, `workload`, `defaultExpanded`, and `steps`
7. Indented fenced `md` block for task description

## Collaborative Editing Metadata

The top front matter now includes default technical metadata for agents. Important keys:

- `format: cancan-markdown-kanban-v1`
- `agent_editing_guide: |` with instructions on preserving the board structure

This is meant to help external agents or manual editors avoid breaking the file while the human mostly uses the UI.

## UI Direction

- Visual direction stays close to the original `markdown-kanban` extension rather than becoming a generic dashboard.
- The app has a light/dark/auto theme toggle.
- `Auto` follows system color preference.
- Search is simple board-local full-text contains search, placed beside the board title.

## Main Feature Additions Beyond The Original Extension Idea

- Multiple boards per folder rather than a single markdown board file focus
- Standalone executable instead of VS Code extension host
- Detached-CWD workspace behavior
- Webview desktop shell via Luminka
- Board-level front matter metadata and board description support
- Agent-oriented `agent_editing_guide` metadata preserved through round-trips
- Theme toggle with system autodetect
- Full-text search input near board title

## Important Interaction Decisions

- Double-clicking a task title opens the edit modal.
- Edit modal shows `Delete` in the left action slot and changes the primary action to `Save Edits`.
- Search clear is inline as an `x` inside the input, not a separate button.

## Implementation Shape

- Go entrypoint with embedded frontend assets from `dist/`
- Frontend implemented as plain static HTML/CSS/JS
- Luminka websocket client implemented directly in frontend code
- Markdown parsing and generation live in frontend JS
