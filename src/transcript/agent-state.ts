/**
 * Turns Claude Code transcript entries (one JSON object per JSONL line) into
 * a live summary of one agent: model, status, current activity and tokens.
 *
 * Pure and synchronous so it can be unit-tested with plain objects.
 */

export type AgentStatus = "running" | "idle" | "done";

export interface TokenTotals {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export interface AgentState {
  id: string;
  /** Short human label: "main", or the subagent's task description. */
  label: string;
  agentType?: string;
  model?: string;
  status: AgentStatus;
  /** What the agent is doing right now, e.g. "Bash git diff". */
  activity: string;
  toolCalls: number;
  tokens: TokenTotals;
  /** Prompt size of the most recent reply (input + cache read + cache write). */
  contextTokens: number;
  startedAt?: number;
  lastActivityAt?: number;
  /** For subagents: the tool_use id in the parent that spawned it. */
  spawnToolUseId?: string;
  depth: number;
  /** tool_use id -> activity text, for tools that have not returned yet. */
  pendingTools: Map<string, string>;
  /** message id -> usage, so a reply split over several lines counts once. */
  usageByMessage: Map<string, TokenTotals>;
}

export interface LogEvent {
  at: number;
  agentId: string;
  text: string;
}

export function newAgentState(id: string, label: string, depth = 0): AgentState {
  return {
    id,
    label,
    status: "running",
    activity: "starting",
    toolCalls: 0,
    tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    contextTokens: 0,
    depth,
    pendingTools: new Map(),
    usageByMessage: new Map(),
  };
}

export function totalTokens(t: TokenTotals): number {
  return t.input + t.cacheRead + t.cacheWrite + t.output;
}

/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Applies one transcript entry to `state` (mutating it) and returns the
 * events worth showing in the session log.
 */
export function applyEntry(state: AgentState, entry: unknown, opts: { skipSidechain?: boolean } = {}): LogEvent[] {
  if (!isObj(entry)) return [];
  if (opts.skipSidechain && entry.isSidechain === true) return [];

  const at = parseTime(entry.timestamp);
  if (at !== undefined) {
    state.startedAt ??= at;
    state.lastActivityAt = Math.max(state.lastActivityAt ?? 0, at);
  }
  const when = at ?? state.lastActivityAt ?? Date.now();

  if (entry.type === "assistant") return applyAssistant(state, entry, when);
  if (entry.type === "user") return applyUser(state, entry, when);
  return [];
}

function applyAssistant(state: AgentState, entry: Json, at: number): LogEvent[] {
  const message = entry.message;
  if (!isObj(message)) return [];

  const model = str(message.model);
  if (model && model !== "<synthetic>") state.model = model;

  const msgId = str(message.id);
  if (msgId && isObj(message.usage)) recordUsage(state, msgId, message.usage);

  const events: LogEvent[] = [];
  const content = Array.isArray(message.content) ? message.content : [];
  if (state.status === "done") return events; // tokens still count; activity stays "done"
  for (const block of content) {
    if (!isObj(block)) continue;
    if (block.type === "tool_use") {
      const id = str(block.id);
      const name = str(block.name) ?? "tool";
      const text = describeTool(name, block.input);
      if (id && !state.pendingTools.has(id)) {
        state.pendingTools.set(id, text);
        state.toolCalls += 1;
        events.push({ at, agentId: state.id, text: `→ ${text}` });
      }
      state.activity = text;
    } else if (block.type === "thinking" && state.pendingTools.size === 0) {
      state.activity = "thinking";
    } else if (block.type === "text" && state.pendingTools.size === 0) {
      state.activity = "writing";
    }
  }

  state.status = message.stop_reason === "end_turn" && state.pendingTools.size === 0 ? "idle" : "running";
  if (state.status === "idle") state.activity = "waiting for input";
  return events;
}

function applyUser(state: AgentState, entry: Json, at: number): LogEvent[] {
  const message = entry.message;
  if (!isObj(message)) return [];
  const content = message.content;

  // A typed prompt (string content, not a system "meta" message) wakes the agent.
  if (typeof content === "string") {
    if (entry.isMeta !== true && state.status !== "done") {
      state.status = "running";
      state.activity = "thinking";
      return [{ at, agentId: state.id, text: `prompt: ${oneLine(content, 60)}` }];
    }
    return [];
  }
  if (!Array.isArray(content)) return [];

  for (const block of content) {
    if (!isObj(block) || block.type !== "tool_result") continue;
    const id = str(block.tool_use_id);
    if (id) state.pendingTools.delete(id);
  }
  if (state.status !== "done") {
    state.status = "running";
    const stillRunning = [...state.pendingTools.values()].at(-1);
    state.activity = stillRunning ?? "thinking";
  }
  return [];
}

function recordUsage(state: AgentState, msgId: string, usage: Json): void {
  const next: TokenTotals = {
    input: num(usage.input_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
    cacheWrite: num(usage.cache_creation_input_tokens),
    output: num(usage.output_tokens),
  };
  const prev = state.usageByMessage.get(msgId);
  if (prev) {
    state.tokens.input -= prev.input;
    state.tokens.cacheRead -= prev.cacheRead;
    state.tokens.cacheWrite -= prev.cacheWrite;
    state.tokens.output -= prev.output;
  }
  state.usageByMessage.set(msgId, next);
  state.tokens.input += next.input;
  state.tokens.cacheRead += next.cacheRead;
  state.tokens.cacheWrite += next.cacheWrite;
  state.tokens.output += next.output;
  state.contextTokens = next.input + next.cacheRead + next.cacheWrite;
}

/** "Bash git diff", "Read auth.ts", "Agent Standards review" ... */
export function describeTool(name: string, input: unknown): string {
  const i = isObj(input) ? input : {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = str(i[k]);
      if (v) return v;
    }
    return undefined;
  };
  let detail: string | undefined;
  switch (name) {
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit":
      detail = basename(pick("file_path", "notebook_path"));
      break;
    case "Grep":
    case "Glob":
      detail = pick("pattern");
      break;
    case "Bash":
      detail = pick("description", "command");
      break;
    case "Agent":
    case "Task":
      detail = pick("description", "subagent_type");
      break;
    case "WebFetch":
      detail = pick("url");
      break;
    case "WebSearch":
      detail = pick("query");
      break;
    default:
      detail = Object.values(i).find((v): v is string => typeof v === "string");
  }
  return detail ? `${name} ${oneLine(detail, 80)}` : name;
}

function basename(p: string | undefined): string | undefined {
  return p?.split("/").filter(Boolean).at(-1);
}

function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function parseTime(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t;
}
