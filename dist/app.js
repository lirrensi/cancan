class LuminkaClient {
  constructor() {
    this.socket = null;
    this.connectPromise = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.fileListeners = new Set();
  }

  async connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const url = `ws://${window.location.host}/ws`;
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    this.connectPromise = new Promise((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
      };

      const onOpen = () => {
        cleanup();
        this.connectPromise = null;
        resolve();
      };

      const onError = () => {
        cleanup();
        this.connectPromise = null;
        this.socket = null;
        reject(new Error("Failed to connect to Luminka runtime"));
      };

      const onClose = () => {
        cleanup();
        this.connectPromise = null;
        this.socket = null;
        this.failAll(new Error("Luminka connection closed"));
        reject(new Error("Luminka connection closed"));
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
    });

    socket.addEventListener("message", event => this.handleMessage(event));
    socket.addEventListener("close", () => {
      this.socket = null;
      this.failAll(new Error("Luminka connection closed"));
    });

    return this.connectPromise;
  }

  async request(frame) {
    await this.connect();
    const id = `req-${this.nextRequestId++}`;
    const message = this.encodeFrame({ ...frame, id });

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(message);
    });
  }

  async appInfo() {
    return this.request({ event: "app_info" });
  }

  async readText(path) {
    const response = await this.request({ event: "fs_read_text", path });
    return response.data || "";
  }

  async writeText(path, data) {
    await this.request({ event: "fs_write_text", path, data });
  }

  async list(path = "") {
    const response = await this.request({ event: "fs_list", path });
    return response.files || [];
  }

  async exists(path) {
    const response = await this.request({ event: "fs_exists", path });
    return Boolean(response.exists);
  }

  async remove(path) {
    await this.request({ event: "fs_delete", path });
  }

  async watch(path) {
    await this.request({ event: "fs_watch", path });
  }

  onFileChanged(listener) {
    this.fileListeners.add(listener);
    return () => this.fileListeners.delete(listener);
  }

  encodeFrame(header, payload = new Uint8Array()) {
    const json = new TextEncoder().encode(JSON.stringify(header));
    const frame = new Uint8Array(4 + json.length + payload.length);
    new DataView(frame.buffer).setUint32(0, json.length, false);
    frame.set(json, 4);
    frame.set(payload, 4 + json.length);
    return frame;
  }

  decodeFrame(buffer) {
    const bytes = new Uint8Array(buffer);
    const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
    const headerBytes = bytes.slice(4, 4 + headerLength);
    const payload = bytes.slice(4 + headerLength);
    return {
      header: JSON.parse(new TextDecoder().decode(headerBytes)),
      payload,
    };
  }

  handleMessage(event) {
    if (!(event.data instanceof ArrayBuffer)) {
      return;
    }

    const { header } = this.decodeFrame(event.data);
    if (header.event === "fs_changed" && header.path) {
      for (const listener of this.fileListeners) {
        listener(header.path);
      }
      return;
    }

    if (!header.id) {
      return;
    }

    const pending = this.pending.get(header.id);
    if (!pending) {
      return;
    }

    this.pending.delete(header.id);
    if (header.ok === false || header.event === "error") {
      pending.reject(new Error(header.error || "Request failed"));
      return;
    }
    pending.resolve(header);
  }

  failAll(error) {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}

const PATHS = {
  rootDir: ".kanban",
  boardsDir: ".kanban/boards",
  config: ".kanban/config.json",
};

const DEFAULT_BOARD_META = {
  format: "cancan-markdown-kanban-v1",
  agent_editing_guide: [
    "This file is primarily edited through the CanCan UI, so preserve the structure when editing manually.",
    "Keep the YAML front matter block at the top if present.",
    "Keep the board title as a single '# ' heading.",
    "Optional board description belongs after the title and before the first '## ' column heading.",
    "Each column must use '## Column Name'.",
    "Each task must use '### Task Title'.",
    "Task properties must stay indented under the task using '- key: value' lines.",
    "Task descriptions must stay inside the indented ```md fenced block.",
    "Do not rewrite unrelated sections or reorder tasks/columns unless intentionally changing the board.",
  ].join("\n"),
};

const PRIORITY_ORDER = { high: 3, medium: 2, low: 1 };
const WORKLOAD_ORDER = { Extreme: 4, Hard: 3, Normal: 2, Easy: 1 };

const state = {
  client: new LuminkaClient(),
  appInfo: null,
  boards: [],
  currentBoard: null,
  currentBoardPath: null,
  currentBoardSlug: null,
  currentFilter: "",
  currentSort: "none",
  expandedTasks: new Set(),
  taskModal: { mode: "create", columnId: null, taskId: null },
  promptResolver: null,
  confirmResolver: null,
  watched: new Set(),
  themePreference: "auto",
  systemThemeQuery: null,
};

function getStoredThemePreference() {
  try {
    return localStorage.getItem("cancan-theme") || "auto";
  } catch {
    return "auto";
  }
}

function setStoredThemePreference(value) {
  try {
    localStorage.setItem("cancan-theme", value);
  } catch {
    // ignore storage failures
  }
}

function getResolvedTheme() {
  if (state.themePreference === "dark") {
    return "dark";
  }
  if (state.themePreference === "light") {
    return "light";
  }
  return state.systemThemeQuery?.matches ? "dark" : "light";
}

function updateThemeButton() {
  const button = document.getElementById("theme-toggle-btn");
  const labels = {
    auto: `Theme: Auto (${getResolvedTheme()})`,
    dark: "Theme: Dark",
    light: "Theme: Light",
  };
  button.textContent = labels[state.themePreference] || labels.auto;
}

function applyTheme() {
  document.body.dataset.theme = getResolvedTheme();
  document.body.dataset.themePreference = state.themePreference;
  updateThemeButton();
}

function cycleThemePreference() {
  const order = ["auto", "dark", "light"];
  const index = order.indexOf(state.themePreference);
  state.themePreference = order[(index + 1) % order.length];
  setStoredThemePreference(state.themePreference);
  applyTheme();
}

function initTheme() {
  state.themePreference = getStoredThemePreference();
  state.systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  state.systemThemeQuery.addEventListener("change", () => {
    if (state.themePreference === "auto") {
      applyTheme();
    }
  });
  applyTheme();
}

class MarkdownKanbanParser {
  static parseMarkdown(content) {
    const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const board = { title: "", description: "", meta: {}, columns: [] };
    let currentColumn = null;
    let currentTask = null;
    let inTaskProperties = false;
    let inTaskDescription = false;
    let inCodeBlock = false;
    let descriptionLines = [];
    let index = 0;

    if (lines[0] && lines[0].trim() === "---") {
      const frontMatterLines = [];
      index = 1;
      while (index < lines.length && lines[index].trim() !== "---") {
        frontMatterLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && lines[index].trim() === "---") {
        board.meta = this.parseFrontMatter(frontMatterLines);
        index += 1;
      } else {
        index = 0;
      }
    }

    for (; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trim();

      if (trimmed.startsWith("```") && inTaskDescription) {
        if (trimmed === "```md" || trimmed === "```") {
          inCodeBlock = !inCodeBlock;
          continue;
        }
      }

      if (inCodeBlock && inTaskDescription && currentTask) {
        if (trimmed === "```") {
          inCodeBlock = false;
          inTaskDescription = false;
        } else {
          const cleanLine = line.replace(/^\s{4,}/, "");
          currentTask.description = currentTask.description
            ? `${currentTask.description}\n${cleanLine}`
            : cleanLine;
        }
        continue;
      }

      if (!board.title && trimmed.startsWith("# ")) {
        board.title = trimmed.slice(2).trim();
        continue;
      }

      if (board.title && !currentColumn && !trimmed.startsWith("## ")) {
        descriptionLines.push(line);
        continue;
      }

      if (trimmed.startsWith("## ")) {
        if (!board.description && descriptionLines.length) {
          board.description = descriptionLines.join("\n").trim();
          descriptionLines = [];
        }
        this.finalizeTask(currentTask, currentColumn);
        currentTask = null;
        if (currentColumn) {
          board.columns.push(currentColumn);
        }

        let title = trimmed.slice(3).trim();
        let archived = false;
        if (title.endsWith("[Archived]")) {
          archived = true;
          title = title.replace(/\s*\[Archived\]$/, "").trim();
        }

        currentColumn = {
          id: this.makeId(),
          title,
          tasks: [],
          archived,
        };
        inTaskProperties = false;
        inTaskDescription = false;
        continue;
      }

      if (this.isTaskTitle(line, trimmed)) {
        this.finalizeTask(currentTask, currentColumn);
        currentTask = null;

        if (currentColumn) {
          let title = "";
          if (trimmed.startsWith("### ")) {
            title = trimmed.slice(4).trim();
          } else {
            title = trimmed.slice(2).trim();
            if (title.startsWith("[ ] ") || title.startsWith("[x] ")) {
              title = title.slice(4).trim();
            }
          }

          currentTask = {
            id: this.makeId(),
            title,
            description: "",
          };
          inTaskProperties = true;
          inTaskDescription = false;
        }
        continue;
      }

      if (currentTask && inTaskProperties) {
        if (this.parseTaskProperty(line, currentTask)) {
          continue;
        }
        if (this.parseTaskStep(line, currentTask)) {
          continue;
        }
        if (/^\s+```md/.test(line)) {
          inTaskProperties = false;
          inTaskDescription = true;
          inCodeBlock = true;
          continue;
        }
      }

      if (trimmed === "") {
        continue;
      }

      if (currentTask && (inTaskProperties || inTaskDescription)) {
        this.finalizeTask(currentTask, currentColumn);
        currentTask = null;
        inTaskProperties = false;
        inTaskDescription = false;
        index -= 1;
      }
    }

    this.finalizeTask(currentTask, currentColumn);
    if (currentColumn) {
      board.columns.push(currentColumn);
    }
    if (!board.description && descriptionLines.length) {
      board.description = descriptionLines.join("\n").trim();
    }

    return board;
  }

  static generateMarkdown(board) {
    let markdown = "";
    markdown += this.generateFrontMatter(board.meta);
    if (board.title) {
      markdown += `# ${board.title}\n\n`;
    }
    if (board.description && board.description.trim()) {
      markdown += `${board.description.trim()}\n\n`;
    }

    for (const column of board.columns) {
      markdown += `## ${column.archived ? `${column.title} [Archived]` : column.title}\n\n`;
      for (const task of column.tasks) {
        markdown += `### ${task.title}\n\n`;
        markdown += this.generateTaskProperties(task);
        if (task.description && task.description.trim()) {
          markdown += "    ```md\n";
          for (const line of task.description.trim().split("\n")) {
            markdown += `    ${line}\n`;
          }
          markdown += "    ```\n";
        }
        markdown += "\n";
      }
    }
    return markdown.trimEnd() + "\n";
  }

  static generateTaskProperties(task) {
    let out = "";
    if (task.dueDate) out += `  - due: ${task.dueDate}\n`;
    if (task.tags && task.tags.length) out += `  - tags: [${task.tags.join(", ")}]\n`;
    if (task.priority) out += `  - priority: ${task.priority}\n`;
    if (task.workload) out += `  - workload: ${task.workload}\n`;
    if (task.defaultExpanded !== undefined) out += `  - defaultExpanded: ${task.defaultExpanded}\n`;
    if (task.steps && task.steps.length) {
      out += "  - steps:\n";
      for (const step of task.steps) {
        out += `      - ${step.completed ? "[x]" : "[ ]"} ${step.text}\n`;
      }
    }
    return out;
  }

  static parseFrontMatter(lines) {
    const meta = {};
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) {
        continue;
      }

      const [, key, rawValue] = match;
      if (rawValue === "|") {
        const block = [];
        index += 1;
        while (index < lines.length && (/^\s+/.test(lines[index]) || lines[index] === "")) {
          block.push(lines[index].replace(/^\s{2}/, ""));
          index += 1;
        }
        index -= 1;
        meta[key] = block.join("\n").trimEnd();
        continue;
      }

      meta[key] = rawValue.trim();
    }
    return meta;
  }

  static generateFrontMatter(meta = {}) {
    const entries = Object.entries(meta).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
    if (!entries.length) {
      return "";
    }

    let output = "---\n";
    for (const [key, value] of entries) {
      const text = String(value);
      if (text.includes("\n")) {
        output += `${key}: |\n`;
        for (const line of text.split("\n")) {
          output += `  ${line}\n`;
        }
      } else {
        output += `${key}: ${text}\n`;
      }
    }
    output += "---\n\n";
    return output;
  }

  static parseTaskProperty(line, task) {
    const match = line.match(/^\s+- (due|tags|priority|workload|steps|defaultExpanded):\s*(.*)$/);
    if (!match) {
      return false;
    }

    const [, property, rawValue] = match;
    const value = rawValue.trim();
    switch (property) {
      case "due":
        task.dueDate = value;
        break;
      case "tags": {
        const tagsMatch = value.match(/\[(.*)\]/);
        if (tagsMatch) {
          task.tags = tagsMatch[1].split(",").map(tag => tag.trim()).filter(Boolean);
        }
        break;
      }
      case "priority":
        if (["low", "medium", "high"].includes(value)) task.priority = value;
        break;
      case "workload":
        if (["Easy", "Normal", "Hard", "Extreme"].includes(value)) task.workload = value;
        break;
      case "defaultExpanded":
        task.defaultExpanded = value.toLowerCase() === "true";
        break;
      case "steps":
        task.steps = [];
        break;
    }
    return true;
  }

  static parseTaskStep(line, task) {
    if (!task.steps) {
      return false;
    }

    const match = line.match(/^\s{6,}- \[([ x])\]\s*(.*)$/);
    if (!match) {
      return false;
    }

    task.steps.push({ text: match[2].trim(), completed: match[1] === "x" });
    return true;
  }

  static finalizeTask(task, column) {
    if (!task || !column) {
      return;
    }
    if (task.description) {
      task.description = task.description.trim();
      if (!task.description) {
        delete task.description;
      }
    }
    column.tasks.push(task);
  }

  static isTaskTitle(line, trimmed) {
    if (line.startsWith("- ") && (trimmed.match(/^\s*- (due|tags|priority|workload|steps|defaultExpanded):/) || /^\s{6,}- \[([ x])\]/.test(line))) {
      return false;
    }
    return (line.startsWith("- ") && !line.startsWith("  ")) || trimmed.startsWith("### ");
  }

  static makeId() {
    return `id-${Math.random().toString(36).slice(2, 11)}`;
  }
}

function escapeHtml(value = "") {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "board";
}

function defaultBoard(title = "Inbox") {
  return {
    title,
    description: "",
    meta: createBoardMeta(),
    columns: [
      { id: MarkdownKanbanParser.makeId(), title: "To Do", tasks: [] },
      { id: MarkdownKanbanParser.makeId(), title: "Doing", tasks: [] },
      { id: MarkdownKanbanParser.makeId(), title: "Done", tasks: [] },
    ],
  };
}

function defaultConfig(lastBoardSlug = "inbox") {
  return {
    version: 1,
    lastBoardSlug,
  };
}

function createBoardMeta(meta = {}) {
  return {
    ...DEFAULT_BOARD_META,
    ...meta,
  };
}

function normalizeBoard(board) {
  return {
    ...board,
    description: board.description || "",
    meta: createBoardMeta(board.meta || {}),
    columns: (board.columns || []).map(column => ({
      ...column,
      tasks: (column.tasks || []).map(task => ({ ...task })),
    })),
  };
}

async function init() {
  initTheme();
  bindStaticEvents();

  try {
    state.appInfo = await state.client.appInfo();
    document.getElementById("workspace-root").textContent = state.appInfo.root;
    await bootstrapWorkspace();
    await loadBoards();
    await loadInitialBoard();
    renderAll();
    await startWatching();
    flashNotice(`Connected to ${state.appInfo.mode} workspace`, false);
  } catch (error) {
    showFatal(error instanceof Error ? error.message : String(error));
  }
}

function bindStaticEvents() {
  document.getElementById("theme-toggle-btn").addEventListener("click", cycleThemePreference);
  document.getElementById("create-board-btn").addEventListener("click", () => createBoardFlow());
  document.getElementById("rename-board-btn").addEventListener("click", () => renameBoardFlow());
  document.getElementById("delete-board-btn").addEventListener("click", () => deleteBoardFlow());
  document.getElementById("add-column-btn").addEventListener("click", () => addColumnFlow());
  document.getElementById("search-input").addEventListener("input", event => {
    state.currentFilter = event.target.value;
    syncSearchClearButton();
    renderBoard();
  });
  document.getElementById("search-clear-btn").addEventListener("click", clearFilters);
  document.getElementById("sort-select").addEventListener("change", event => {
    state.currentSort = event.target.value;
    renderBoard();
  });

  document.getElementById("task-form").addEventListener("submit", submitTaskForm);
  document.getElementById("task-delete-btn").addEventListener("click", () => deleteCurrentEditingTask());
  document.getElementById("add-tag-btn").addEventListener("click", addTagFromInput);
  document.getElementById("tags-input").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTagFromInput();
    }
  });
  document.getElementById("add-step-btn").addEventListener("click", addStepFromInput);
  document.getElementById("steps-input").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      addStepFromInput();
    }
  });

  for (const button of document.querySelectorAll("[data-close-modal]")) {
    button.addEventListener("click", event => closeModal(event.currentTarget.dataset.closeModal));
  }

  document.getElementById("prompt-cancel").addEventListener("click", () => resolvePrompt(null));
  document.getElementById("prompt-confirm").addEventListener("click", () => resolvePrompt(document.getElementById("prompt-input").value.trim()));
  document.getElementById("prompt-input").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      resolvePrompt(document.getElementById("prompt-input").value.trim());
    }
  });

  document.getElementById("confirm-cancel").addEventListener("click", () => resolveConfirm(false));
  document.getElementById("confirm-ok").addEventListener("click", () => resolveConfirm(true));

  for (const modal of document.querySelectorAll(".modal")) {
    modal.addEventListener("click", event => {
      if (event.target === modal) {
        closeModal(modal.id);
      }
    });
  }
}

async function bootstrapWorkspace() {
  const configExists = await state.client.exists(PATHS.config);
  if (!configExists) {
    const board = defaultBoard();
    await state.client.writeText(`${PATHS.boardsDir}/inbox.md`, MarkdownKanbanParser.generateMarkdown(board));
    await writeJSON(PATHS.config, defaultConfig());
    return;
  }

  const boardsDirExists = await state.client.exists(PATHS.boardsDir);
  if (!boardsDirExists) {
    const board = defaultBoard();
    await state.client.writeText(`${PATHS.boardsDir}/inbox.md`, MarkdownKanbanParser.generateMarkdown(board));
  }
}

async function readJSON(path, fallback = null) {
  try {
    return JSON.parse(await state.client.readText(path));
  } catch {
    return fallback;
  }
}

async function writeJSON(path, value) {
  await state.client.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function loadBoards() {
  let entries = [];
  try {
    entries = await state.client.list(PATHS.boardsDir);
  } catch {
    entries = [];
  }

  const markdownFiles = entries.filter(entry => entry.toLowerCase().endsWith(".md"));
  const boards = [];

  for (const entry of markdownFiles) {
    const slug = entry.replace(/\.md$/i, "");
    const path = `${PATHS.boardsDir}/${entry}`;
    let title = slug;
    let parseError = false;
    try {
      const parsed = MarkdownKanbanParser.parseMarkdown(await state.client.readText(path));
      title = parsed.title || slug;
    } catch {
      parseError = true;
    }
    boards.push({ slug, title, path, parseError });
  }

  boards.sort((left, right) => left.title.localeCompare(right.title));
  state.boards = boards;
}

async function loadInitialBoard() {
  const config = await readJSON(PATHS.config, defaultConfig());
  const preferred = config?.lastBoardSlug;
  const board = state.boards.find(item => item.slug === preferred) || state.boards[0];

  if (!board) {
    const fallback = defaultBoard();
    await state.client.writeText(`${PATHS.boardsDir}/inbox.md`, MarkdownKanbanParser.generateMarkdown(fallback));
    await loadBoards();
    return loadInitialBoard();
  }

  await openBoard(board.slug);
}

async function openBoard(slug) {
  const boardRef = state.boards.find(item => item.slug === slug);
  if (!boardRef) {
    return;
  }

  const raw = await state.client.readText(boardRef.path);
  const parsed = MarkdownKanbanParser.parseMarkdown(raw);

  state.currentBoard = normalizeBoard(parsed);
  state.currentBoardPath = boardRef.path;
  state.currentBoardSlug = boardRef.slug;
  state.expandedTasks = new Set();
  hydrateDefaultExpandedTasks();
  await updateConfig({ lastBoardSlug: slug });
  renderAll();
}

function hydrateDefaultExpandedTasks() {
  if (!state.currentBoard) {
    return;
  }
  for (const column of state.currentBoard.columns) {
    for (const task of column.tasks) {
      if (task.defaultExpanded) {
        state.expandedTasks.add(task.id);
      }
    }
  }
}

async function updateConfig(patch) {
  const current = (await readJSON(PATHS.config, defaultConfig())) || defaultConfig();
  await writeJSON(PATHS.config, { ...current, ...patch });
}

async function saveCurrentBoard() {
  if (!state.currentBoardPath || !state.currentBoard) {
    return;
  }
  state.currentBoard = normalizeBoard(state.currentBoard);
  await state.client.writeText(state.currentBoardPath, MarkdownKanbanParser.generateMarkdown(state.currentBoard));
  await loadBoards();
  renderSidebar();
}

async function createBoardFlow() {
  const title = await promptForValue("Create board", "Name the new board.", "Board title");
  if (!title) {
    return;
  }

  const slug = await uniqueSlugForTitle(title);
  const board = defaultBoard(title);
  await state.client.writeText(`${PATHS.boardsDir}/${slug}.md`, MarkdownKanbanParser.generateMarkdown(board));
  await loadBoards();
  await openBoard(slug);
  flashNotice(`Created board ${title}`, false);
}

async function renameBoardFlow() {
  if (!state.currentBoard || !state.currentBoardSlug) {
    return;
  }

  const nextTitle = await promptForValue("Rename board", "Rename the active board.", "Board title", state.currentBoard.title);
  if (!nextTitle || nextTitle === state.currentBoard.title) {
    return;
  }

  const nextSlug = await uniqueSlugForTitle(nextTitle, state.currentBoardSlug);
  const previousPath = state.currentBoardPath;
  state.currentBoard.title = nextTitle;

  const nextPath = `${PATHS.boardsDir}/${nextSlug}.md`;
  await state.client.writeText(nextPath, MarkdownKanbanParser.generateMarkdown(state.currentBoard));
  if (previousPath !== nextPath) {
    await state.client.remove(previousPath);
  }

  await loadBoards();
  state.currentBoardPath = nextPath;
  state.currentBoardSlug = nextSlug;
  await updateConfig({ lastBoardSlug: nextSlug });
  renderAll();
  flashNotice(`Renamed board to ${nextTitle}`, false);
}

async function deleteBoardFlow() {
  if (!state.currentBoardSlug || !state.currentBoardPath) {
    return;
  }

  const confirmed = await confirmAction("Delete board", `Delete ${state.currentBoard.title}? This removes the markdown file from .kanban/boards/.`, "Delete");
  if (!confirmed) {
    return;
  }

  await state.client.remove(state.currentBoardPath);
  await loadBoards();

  if (!state.boards.length) {
    const board = defaultBoard();
    await state.client.writeText(`${PATHS.boardsDir}/inbox.md`, MarkdownKanbanParser.generateMarkdown(board));
    await loadBoards();
  }

  await openBoard(state.boards[0].slug);
  flashNotice("Board deleted", false);
}

async function uniqueSlugForTitle(title, existingSlug = null) {
  const base = slugify(title);
  let candidate = base;
  let count = 2;
  while (state.boards.some(board => board.slug === candidate && board.slug !== existingSlug)) {
    candidate = `${base}-${count}`;
    count += 1;
  }
  return candidate;
}

async function addColumnFlow() {
  if (!state.currentBoard) {
    return;
  }
  const title = await promptForValue("Add column", "Name the new column.", "Column title");
  if (!title) {
    return;
  }
  state.currentBoard.columns.push({ id: MarkdownKanbanParser.makeId(), title, tasks: [] });
  await saveCurrentBoard();
  renderBoard();
}

function clearFilters() {
  state.currentFilter = "";
  document.getElementById("search-input").value = "";
  syncSearchClearButton();
  renderBoard();
}

function syncSearchClearButton() {
  const button = document.getElementById("search-clear-btn");
  button.classList.toggle("hidden", !state.currentFilter.trim());
}

function renderAll() {
  renderSidebar();
  renderBoard();
}

function renderSidebar() {
  const boardList = document.getElementById("board-list");
  if (!state.boards.length) {
    boardList.innerHTML = '<div class="board-empty">No boards yet.</div>';
    return;
  }

  boardList.innerHTML = state.boards.map(board => `
    <button class="board-item ${board.slug === state.currentBoardSlug ? "active" : ""}" data-board-slug="${escapeHtml(board.slug)}">
      <span class="board-item-copy">
        <span class="board-item-title">${escapeHtml(board.title)}</span>
        <span class="board-item-meta">${board.parseError ? "Parse error" : board.slug}</span>
      </span>
      <span class="count-pill">md</span>
    </button>
  `).join("");

  for (const button of boardList.querySelectorAll("[data-board-slug]")) {
    button.addEventListener("click", async event => {
      const slug = event.currentTarget.dataset.boardSlug;
      await openBoard(slug);
    });
  }
}

function renderBoard() {
  document.getElementById("board-title").textContent = state.currentBoard?.title || "No board";
  syncSearchClearButton();
  const descriptionElement = document.getElementById("board-description");
  const description = state.currentBoard?.description?.trim() || "";
  descriptionElement.textContent = description;
  descriptionElement.classList.toggle("hidden", !description);
  const boardElement = document.getElementById("kanban-board");

  if (!state.currentBoard) {
    boardElement.innerHTML = '<div class="board-placeholder">No board loaded.</div>';
    return;
  }

  const normalColumns = state.currentBoard.columns.filter(column => !column.archived);
  const archivedColumns = state.currentBoard.columns.filter(column => column.archived);
  const orderedColumns = [...normalColumns, ...archivedColumns];

  boardElement.innerHTML = orderedColumns.map(column => renderColumn(column)).join("");

  bindBoardEvents();
}

function renderColumn(column) {
  const tasks = sortTasks(filterTasks(column.tasks));
  return `
    <section class="kanban-column ${column.archived ? "archived" : ""}" data-column-id="${escapeHtml(column.id)}">
      <div class="column-header" draggable="true">
        <div>
          <h3 class="column-title">${escapeHtml(column.title)}${column.archived ? " [Archived]" : ""}</h3>
        </div>
        <div class="column-meta">
          <span class="count-pill">${tasks.length}</span>
          <button class="ghost-btn small-btn" data-toggle-archive="${escapeHtml(column.id)}">${column.archived ? "Unarchive" : "Archive"}</button>
        </div>
      </div>
      <div class="tasks-container" data-tasks-column="${escapeHtml(column.id)}">
        ${tasks.map(task => renderTask(task, column.id)).join("")}
      </div>
      <div class="column-footer">
        <button class="ghost-btn" data-add-task="${escapeHtml(column.id)}">+ Add Task</button>
      </div>
    </section>
  `;
}

function renderTask(task, columnId) {
  const expanded = state.expandedTasks.has(task.id);
  const deadline = getDeadlineInfo(task.dueDate);
  const progress = getStepsProgress(task.steps);
  return `
    <article class="task-item ${expanded ? "expanded" : ""}" data-task-id="${escapeHtml(task.id)}" data-column-id="${escapeHtml(columnId)}">
      <div class="task-header">
        <div class="task-drag-handle" title="Drag task">⋮⋮</div>
        <button class="task-title-button" type="button" data-edit-task-title="${escapeHtml(task.id)}" data-column="${escapeHtml(columnId)}">
          <span class="task-title">${escapeHtml(task.title)}</span>
        </button>
        <div class="task-meta">
          ${progress.total > 0 ? `<span class="task-steps-progress">${progress.completed}/${progress.total}</span>` : ""}
          ${task.priority ? `<span class="task-priority priority-${escapeHtml(task.priority)}"></span>` : ""}
        </div>
      </div>
      <div class="task-tags-row">
        <div class="task-tags">
          ${task.workload ? `<span class="task-tag workload-${task.workload.toLowerCase()}">${escapeHtml(task.workload)}</span>` : ""}
          ${(task.tags || []).map(tag => `<span class="task-tag">${escapeHtml(tag)}</span>`).join("")}
        </div>
        ${deadline ? `<span class="task-deadline deadline-${deadline.status}">${escapeHtml(deadline.text)}</span>` : ""}
      </div>
      <div class="task-details">
        ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ""}
        ${renderTaskSteps(task, columnId)}
        <div class="task-info">
          ${task.dueDate ? `<span class="task-info-item"><span class="task-info-label">Due</span><span>${escapeHtml(task.dueDate)}</span></span>` : ""}
          ${task.workload ? `<span class="task-info-item"><span class="task-info-label">Workload</span><span class="task-workload workload-${task.workload.toLowerCase()}">${escapeHtml(task.workload)}</span></span>` : ""}
        </div>
      </div>
      <div class="task-actions">
        <div class="action-row">
          <button class="ghost-btn small-btn" data-edit-task="${escapeHtml(task.id)}" data-column="${escapeHtml(columnId)}">Edit</button>
          <button class="danger-btn small-btn" data-delete-task="${escapeHtml(task.id)}" data-column="${escapeHtml(columnId)}">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function renderTaskSteps(task, columnId) {
  if (!task.steps || !task.steps.length) {
    return "";
  }
  return `
    <div class="task-steps">
      <div class="task-steps-header">Steps</div>
      <div class="task-steps-list" data-step-column="${escapeHtml(columnId)}" data-step-task="${escapeHtml(task.id)}">
        ${task.steps.map((step, index) => `
          <label class="task-step-item" data-step-index="${index}">
            <span class="step-drag-handle">⋮⋮</span>
            <input type="checkbox" ${step.completed ? "checked" : ""} data-toggle-step="${escapeHtml(task.id)}" data-column="${escapeHtml(columnId)}" data-step-index="${index}">
            <span class="task-step-text ${step.completed ? "completed" : ""}">${escapeHtml(step.text)}</span>
            <span></span>
          </label>
        `).join("")}
      </div>
    </div>
  `;
}

function bindBoardEvents() {
  for (const button of document.querySelectorAll("[data-add-task]")) {
    button.addEventListener("click", event => openTaskModal("create", event.currentTarget.dataset.addTask));
  }

  for (const button of document.querySelectorAll("[data-edit-task]")) {
    button.addEventListener("click", event => openTaskModal("edit", event.currentTarget.dataset.column, event.currentTarget.dataset.editTask));
  }

  for (const button of document.querySelectorAll("[data-edit-task-title]")) {
    button.addEventListener("click", event => event.stopPropagation());
    button.addEventListener("dblclick", event => {
      event.preventDefault();
      event.stopPropagation();
      openTaskModal("edit", event.currentTarget.dataset.column, event.currentTarget.dataset.editTaskTitle);
    });
  }

  for (const button of document.querySelectorAll("[data-delete-task]")) {
    button.addEventListener("click", event => deleteTaskFlow(event.currentTarget.dataset.column, event.currentTarget.dataset.deleteTask));
  }

  for (const button of document.querySelectorAll("[data-toggle-archive]")) {
    button.addEventListener("click", async event => {
      const column = findColumn(event.currentTarget.dataset.toggleArchive);
      if (!column) {
        return;
      }
      column.archived = !column.archived;
      await saveCurrentBoard();
      renderBoard();
    });
  }

  for (const input of document.querySelectorAll("[data-toggle-step]")) {
    input.addEventListener("click", event => event.stopPropagation());
    input.addEventListener("change", async event => {
      const { toggleStep, column, stepIndex } = event.currentTarget.dataset;
      const task = findTask(column, toggleStep);
      if (!task || !task.steps?.[Number(stepIndex)]) {
        return;
      }
      task.steps[Number(stepIndex)].completed = event.currentTarget.checked;
      await saveCurrentBoard();
      renderBoard();
    });
  }

  for (const task of document.querySelectorAll(".task-item")) {
    task.addEventListener("click", event => {
      if (event.target.closest("button") || event.target.closest("input")) {
        return;
      }
      toggleTaskExpansion(task.dataset.taskId);
    });
  }

  setupTaskDragAndDrop();
  setupColumnDragAndDrop();
}

function toggleTaskExpansion(taskId) {
  if (state.expandedTasks.has(taskId)) {
    state.expandedTasks.delete(taskId);
  } else {
    state.expandedTasks.add(taskId);
  }
  renderBoard();
}

function filterTasks(tasks) {
  if (!state.currentFilter) {
    return tasks;
  }
  const needle = state.currentFilter.toLowerCase().trim();
  if (!needle) {
    return tasks;
  }
  return tasks.filter(task => {
    const haystack = [
      task.title,
      task.description,
      task.priority,
      task.workload,
      task.dueDate,
      ...(task.tags || []),
      ...((task.steps || []).map(step => step.text)),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

function sortTasks(tasks) {
  const sorted = [...tasks];
  switch (state.currentSort) {
    case "title":
      return sorted.sort((left, right) => left.title.localeCompare(right.title));
    case "deadline":
      return sorted.sort((left, right) => {
        if (!left.dueDate && !right.dueDate) return 0;
        if (!left.dueDate) return 1;
        if (!right.dueDate) return -1;
        return new Date(left.dueDate) - new Date(right.dueDate);
      });
    case "priority":
      return sorted.sort((left, right) => (PRIORITY_ORDER[right.priority] || 0) - (PRIORITY_ORDER[left.priority] || 0));
    case "workload":
      return sorted.sort((left, right) => (WORKLOAD_ORDER[right.workload] || 0) - (WORKLOAD_ORDER[left.workload] || 0));
    case "tags":
      return sorted.sort((left, right) => ((left.tags && left.tags[0]) || "").localeCompare((right.tags && right.tags[0]) || ""));
    default:
      return sorted;
  }
}

function getDeadlineInfo(dueDate) {
  if (!dueDate) {
    return null;
  }
  const today = new Date();
  const deadline = new Date(dueDate);
  const diffDays = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { status: "overdue", text: `Overdue ${Math.abs(diffDays)} days` };
  if (diffDays === 0) return { status: "urgent", text: "Due today" };
  if (diffDays === 1) return { status: "urgent", text: "Due tomorrow" };
  if (diffDays <= 3) return { status: "upcoming", text: `${diffDays} days left` };
  return { status: "normal", text: `${diffDays} days left` };
}

function getStepsProgress(steps) {
  if (!steps || !steps.length) {
    return { completed: 0, total: 0 };
  }
  return { completed: steps.filter(step => step.completed).length, total: steps.length };
}

function findColumn(columnId) {
  return state.currentBoard?.columns.find(column => column.id === columnId) || null;
}

function findTask(columnId, taskId) {
  const column = findColumn(columnId);
  if (!column) {
    return null;
  }
  return column.tasks.find(task => task.id === taskId) || null;
}

function openTaskModal(mode, columnId, taskId = null) {
  state.taskModal = { mode, columnId, taskId };
  const title = document.getElementById("task-modal-title");
  title.textContent = mode === "edit" ? "Edit Task" : "Add Task";
  resetTaskForm();
  syncTaskModalActions();

  if (mode === "edit") {
    const task = findTask(columnId, taskId);
    if (!task) {
      return;
    }
    document.getElementById("task-title").value = task.title || "";
    document.getElementById("task-description").value = task.description || "";
    document.getElementById("task-priority").value = task.priority || "";
    document.getElementById("task-workload").value = task.workload || "";
    document.getElementById("task-due-date").value = task.dueDate || "";
    document.getElementById("task-default-expanded").checked = Boolean(task.defaultExpanded);
    for (const tag of task.tags || []) addChip("tags-container", tag, "chip");
    for (const step of task.steps || []) addStepItem(step.text, step.completed);
  }

  showModal("task-modal");
  document.getElementById("task-title").focus();
}

function resetTaskForm() {
  document.getElementById("task-form").reset();
  document.getElementById("tags-container").innerHTML = "";
  document.getElementById("steps-list").innerHTML = "";
}

function syncTaskModalActions() {
  const isEdit = state.taskModal.mode === "edit";
  document.getElementById("task-delete-btn").classList.toggle("hidden", !isEdit);
  document.getElementById("task-cancel-btn").classList.toggle("hidden", isEdit);
  document.getElementById("task-submit-btn").textContent = isEdit ? "Save Edits" : "Save Task";
}

async function submitTaskForm(event) {
  event.preventDefault();
  const title = document.getElementById("task-title").value.trim();
  if (!title) {
    return;
  }

  const payload = {
    title,
    description: document.getElementById("task-description").value.trim(),
    priority: document.getElementById("task-priority").value || undefined,
    workload: document.getElementById("task-workload").value || undefined,
    dueDate: document.getElementById("task-due-date").value || undefined,
    defaultExpanded: document.getElementById("task-default-expanded").checked,
    tags: collectChips("tags-container"),
    steps: collectSteps(),
  };

  const column = findColumn(state.taskModal.columnId);
  if (!column) {
    return;
  }

  if (state.taskModal.mode === "edit") {
    const task = findTask(state.taskModal.columnId, state.taskModal.taskId);
    if (!task) {
      return;
    }
    Object.assign(task, payload);
  } else {
    column.tasks.push({ id: MarkdownKanbanParser.makeId(), ...payload });
  }

  closeModal("task-modal");
  await saveCurrentBoard();
  renderBoard();
}

function addTagFromInput() {
  const input = document.getElementById("tags-input");
  const value = input.value.trim();
  if (!value) {
    return;
  }
  if (!collectChips("tags-container").includes(value)) {
    addChip("tags-container", value, "chip");
  }
  input.value = "";
}

function addChip(containerId, text, className) {
  const container = document.getElementById(containerId);
  const chip = document.createElement("span");
  chip.className = className;
  chip.innerHTML = `${escapeHtml(text)} <button type="button" class="chip-remove">x</button>`;
  chip.querySelector("button").addEventListener("click", () => chip.remove());
  container.appendChild(chip);
}

function collectChips(containerId) {
  return Array.from(document.getElementById(containerId).children).map(child => child.textContent.replace(/x$/, "").trim());
}

function addStepFromInput() {
  const input = document.getElementById("steps-input");
  const value = input.value.trim();
  if (!value) {
    return;
  }
  addStepItem(value, false);
  input.value = "";
}

function addStepItem(text, completed) {
  const item = document.createElement("label");
  item.className = "step-item";
  item.innerHTML = `
    <span class="step-drag-handle">⋮⋮</span>
    <input type="checkbox" ${completed ? "checked" : ""}>
    <span class="step-text ${completed ? "completed" : ""}">${escapeHtml(text)}</span>
    <button type="button" class="step-remove">x</button>
  `;
  item.querySelector("input").addEventListener("change", event => {
    item.querySelector(".step-text").classList.toggle("completed", event.currentTarget.checked);
  });
  item.querySelector("button").addEventListener("click", () => item.remove());
  document.getElementById("steps-list").appendChild(item);
}

function collectSteps() {
  return Array.from(document.getElementById("steps-list").children).map(item => ({
    text: item.querySelector(".step-text").textContent.trim(),
    completed: item.querySelector("input").checked,
  }));
}

async function deleteTaskFlow(columnId, taskId) {
  const task = findTask(columnId, taskId);
  if (!task) {
    return;
  }
  const confirmed = await confirmAction("Delete task", `Delete ${task.title}?`, "Delete");
  if (!confirmed) {
    return;
  }
  const column = findColumn(columnId);
  column.tasks = column.tasks.filter(item => item.id !== taskId);
  await saveCurrentBoard();
  renderBoard();
}

async function deleteCurrentEditingTask() {
  if (state.taskModal.mode !== "edit") {
    return;
  }
  const { columnId, taskId } = state.taskModal;
  closeModal("task-modal");
  await deleteTaskFlow(columnId, taskId);
}

function showModal(id) {
  document.getElementById(id).classList.remove("hidden");
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
  if (id === "task-modal") {
    state.taskModal = { mode: "create", columnId: null, taskId: null };
    syncTaskModalActions();
  }
  if (id === "prompt-modal") {
    resolvePrompt(null);
  }
  if (id === "confirm-modal") {
    resolveConfirm(false);
  }
}

function promptForValue(title, message, placeholder, value = "") {
  document.getElementById("prompt-title").textContent = title;
  document.getElementById("prompt-message").textContent = message;
  const input = document.getElementById("prompt-input");
  input.value = value;
  input.placeholder = placeholder;
  showModal("prompt-modal");
  input.focus();

  return new Promise(resolve => {
    state.promptResolver = resolve;
  });
}

function resolvePrompt(value) {
  if (!state.promptResolver) {
    document.getElementById("prompt-modal").classList.add("hidden");
    return;
  }
  const resolver = state.promptResolver;
  state.promptResolver = null;
  document.getElementById("prompt-modal").classList.add("hidden");
  resolver(value || null);
}

function confirmAction(title, message, confirmLabel) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").textContent = message;
  document.getElementById("confirm-ok").textContent = confirmLabel;
  showModal("confirm-modal");
  return new Promise(resolve => {
    state.confirmResolver = resolve;
  });
}

function resolveConfirm(value) {
  if (!state.confirmResolver) {
    document.getElementById("confirm-modal").classList.add("hidden");
    return;
  }
  const resolver = state.confirmResolver;
  state.confirmResolver = null;
  document.getElementById("confirm-modal").classList.add("hidden");
  resolver(Boolean(value));
}

function flashNotice(message, isError) {
  const bar = document.getElementById("notice-bar");
  bar.textContent = message;
  bar.classList.remove("hidden");
  bar.style.background = isError ? "#f7ddd6" : "#fbeed6";
  bar.style.color = isError ? "#7c2b1d" : "#6c4b1f";
}

function showFatal(message) {
  flashNotice(message, true);
  document.getElementById("kanban-board").innerHTML = `<div class="board-placeholder">${escapeHtml(message)}</div>`;
}

async function startWatching() {
  for (const path of [PATHS.boardsDir, PATHS.config]) {
    if (state.watched.has(path)) {
      continue;
    }
    try {
      await state.client.watch(path);
      state.watched.add(path);
    } catch {
      // ignore optional watch failures
    }
  }

  state.client.onFileChanged(async path => {
    if (!path.startsWith(PATHS.boardsDir) && path !== PATHS.config) {
      return;
    }
    try {
      const currentSlug = state.currentBoardSlug;
      await loadBoards();
      if (currentSlug && state.boards.some(board => board.slug === currentSlug)) {
        await openBoard(currentSlug);
      }
    } catch {
      // ignore watch refresh failures
    }
  });
}

function setupTaskDragAndDrop() {
  for (const columnElement of document.querySelectorAll("[data-tasks-column]")) {
    columnElement.addEventListener("dragover", event => {
      event.preventDefault();
      columnElement.parentElement.classList.add("drag-over");
      const dragging = document.querySelector(".task-item.dragging");
      if (!dragging) {
        return;
      }
      const after = getDragAfterElement(columnElement, event.clientY, ".task-item:not(.dragging)");
      columnElement.querySelectorAll(".task-item").forEach(item => item.classList.remove("drag-insert-before", "drag-insert-after"));
      if (!after) {
        const last = columnElement.querySelector(".task-item:last-child");
        if (last && last !== dragging) {
          last.classList.add("drag-insert-after");
        }
      } else if (after !== dragging) {
        after.classList.add("drag-insert-before");
      }
    });

    columnElement.addEventListener("dragleave", event => {
      if (!columnElement.contains(event.relatedTarget)) {
        columnElement.parentElement.classList.remove("drag-over");
      }
    });

    columnElement.addEventListener("drop", async event => {
      event.preventDefault();
      columnElement.parentElement.classList.remove("drag-over");
      const taskId = event.dataTransfer.getData("text/task-id");
      const fromColumnId = event.dataTransfer.getData("text/column-id");
      const toColumnId = columnElement.dataset.tasksColumn;
      if (!taskId || !fromColumnId || !toColumnId) {
        return;
      }

      const fromColumn = findColumn(fromColumnId);
      const toColumn = findColumn(toColumnId);
      if (!fromColumn || !toColumn) {
        return;
      }

      const fromIndex = fromColumn.tasks.findIndex(task => task.id === taskId);
      if (fromIndex === -1) {
        return;
      }

      const [task] = fromColumn.tasks.splice(fromIndex, 1);
      const targetCards = Array.from(columnElement.querySelectorAll(".task-item:not(.dragging)"));
      const after = getDragAfterElement(columnElement, event.clientY, ".task-item:not(.dragging)");
      const insertIndex = after ? targetCards.indexOf(after) : toColumn.tasks.length;
      toColumn.tasks.splice(insertIndex, 0, task);

      await saveCurrentBoard();
      renderBoard();
    });
  }

  for (const task of document.querySelectorAll(".task-item")) {
    const handle = task.querySelector(".task-drag-handle");
    handle.draggable = true;
    handle.addEventListener("dragstart", event => {
      event.stopPropagation();
      task.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/task-id", task.dataset.taskId);
      event.dataTransfer.setData("text/column-id", task.dataset.columnId);
    });
    handle.addEventListener("dragend", () => {
      task.classList.remove("dragging");
      document.querySelectorAll(".task-item").forEach(item => item.classList.remove("drag-insert-before", "drag-insert-after"));
      document.querySelectorAll(".kanban-column").forEach(item => item.classList.remove("drag-over"));
    });
  }
}

function setupColumnDragAndDrop() {
  const columns = Array.from(document.querySelectorAll(".kanban-column"));
  for (const [index, column] of columns.entries()) {
    const header = column.querySelector(".column-header");
    header.addEventListener("dragstart", event => {
      column.classList.add("column-dragging");
      event.dataTransfer.setData("text/column-index", String(index));
      event.dataTransfer.effectAllowed = "move";
    });
    header.addEventListener("dragend", () => {
      column.classList.remove("column-dragging");
      columns.forEach(item => item.classList.remove("drag-over"));
    });

    column.addEventListener("dragover", event => {
      if (!document.querySelector(".column-dragging")) {
        return;
      }
      event.preventDefault();
      column.classList.add("drag-over");
    });

    column.addEventListener("dragleave", event => {
      if (!column.contains(event.relatedTarget)) {
        column.classList.remove("drag-over");
      }
    });

    column.addEventListener("drop", async event => {
      const fromIndex = Number(event.dataTransfer.getData("text/column-index"));
      if (Number.isNaN(fromIndex) || fromIndex === index) {
        return;
      }
      event.preventDefault();
      column.classList.remove("drag-over");
      const moved = state.currentBoard.columns.splice(fromIndex, 1)[0];
      state.currentBoard.columns.splice(index, 0, moved);
      await saveCurrentBoard();
      renderBoard();
    });
  }
}

function getDragAfterElement(container, y, selector) {
  const draggableElements = [...container.querySelectorAll(selector)];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

window.addEventListener("error", event => {
  flashNotice(event.message, true);
});

init();
