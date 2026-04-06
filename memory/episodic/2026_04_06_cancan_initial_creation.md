---
summary: "Initial CanCan creation session: created a Luminka-based standalone kanban app derived from markdown-kanban ideas"
created: 2026-04-06
updated: 2026-04-06
memory_type: episodic
tags: [code, cancan, milestone, luminka, markdown-kanban, architecture, decisions]
---

# Initial CanCan Creation

## What Happened

The project started from an empty folder. The initial request was to take the idea from `markdown-kanban` and turn it into a command-line-launched kanban app that can run in any folder and store a local folder of kanban boards.

The direction was later clarified and locked in as:

- `detached` mode with dynamic current working directory
- `webview` runtime
- executable command name `cancan`
- visuals staying close to the original extension

## Key Architectural Decisions

- Use Luminka as the local runtime instead of building a full separate desktop shell from scratch.
- Store data in `.kanban/` inside the active folder.
- Store each board as one markdown file inside `.kanban/boards/`.
- Keep markdown readable and round-trippable.
- Implement the frontend in plain static assets embedded into the Go binary.

## Notable Additions After The First Build

- Added theme toggle with `Auto`, `Dark`, and `Light`
- `Auto` follows system theme
- Added double-click-on-title editing for tasks
- Adjusted edit modal actions to match the requested UX
- Replaced tag-only filtering with general full-text search beside the board title
- Added YAML-like top front matter support
- Added board description support
- Added default `agent_editing_guide` metadata so collaborative/agent edits preserve file structure

## Why This Matters

This project is intentionally both a human UI tool and an agent-collaborative markdown system. The file format and metadata are part of the product, not just implementation detail.
