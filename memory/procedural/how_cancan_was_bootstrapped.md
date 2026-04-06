---
summary: "How CanCan was initially designed and implemented from markdown-kanban plus Luminka"
created: 2026-04-06
updated: 2026-04-06
memory_type: procedural
tags: [code, cancan, workflow, luminka, markdown-kanban, bootstrap]
---

# How CanCan Was Bootstrapped

## Reference Sources

The initial app design came from combining two references:

- `holooooo/markdown-kanban` as the board format and UI inspiration
- `lirrensi/luminka` as the local runtime and desktop shell model

## Design Mapping

- Reuse the markdown board structure and interaction concepts from `markdown-kanban`
- Replace VS Code-specific integration with Luminka filesystem calls
- Use Luminka detached mode so running from any folder makes that folder the workspace
- Ship as a local executable named `cancan`

## Initial Build Approach

1. Create a Go app using Luminka as the runtime.
2. Embed frontend assets from `dist/` into the executable.
3. Configure Luminka for detached root policy and webview mode.
4. Enable filesystem access only.
5. Build the UI as static HTML/CSS/JS.
6. Implement markdown parsing and generation client-side.
7. Store boards in `.kanban/boards/` under the current working directory.

## First-Run Behavior

On first launch in an empty folder:

1. Create `.kanban/`
2. Create `.kanban/boards/`
3. Create `.kanban/config.json`
4. Create `.kanban/boards/inbox.md`

## Ongoing Save Behavior

- UI edits regenerate the current board markdown file.
- Board metadata and technical front matter should be preserved.
- New boards should include default agent-editing metadata.
- The file format should remain safe for both UI-first human use and agent/manual edits.

## Important Constraints To Preserve

- Keep the project local-first.
- Keep detached current-working-directory behavior.
- Keep standalone webview runtime as the main target.
- Do not drift away from readable markdown storage.
- Preserve the `agent_editing_guide` metadata in board files.
- Prefer UI changes that still respect the extension-inspired interaction model.
