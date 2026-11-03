import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { applyEntry, type AgentState, type LogEvent, newAgentState } from "./transcript/agent-state.js";
import { JsonlTail } from "./transcript/tail.js";

export interface SessionSnapshot {
  sessionId: string;
  transcriptPath: string;
  cwd?: string;
  main: AgentState;
  /** Subagents in the order they started. */
  agents: AgentState[];
  /** Most recent events last. */
  events: LogEvent[];
}

interface SubagentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  spawnDepth?: number;
  pickedEffortModel?: string;
  finished?: boolean;
}

interface Tracked {
  state: AgentState;
  tail: JsonlTail;
  metaPath: string;
}

const MAX_EVENTS = 200;

export const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * Follows one Claude Code session: the main transcript plus every subagent
 * transcript under `<session>/subagents/`. Call `poll()` on a timer, or use
 * `start()`.
 */
export class SessionWatcher {
  readonly sessionId: string;
  private readonly mainTail: JsonlTail;
  private readonly main: AgentState;
  private readonly subagentsDir: string;
  private readonly agents = new Map<string, Tracked>();
  private events: LogEvent[] = [];
  private cwd?: string;
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(readonly transcriptPath: string) {
    this.sessionId = basename(transcriptPath, ".jsonl");
    this.mainTail = new JsonlTail(transcriptPath);
    this.main = newAgentState("main", "main");
    this.subagentsDir = join(transcriptPath.replace(/\.jsonl$/, ""), "subagents");
  }

  start(intervalMs: number, onUpdate: (s: SessionSnapshot) => void): void {
    const tick = async () => {
      if (this.polling) return;
      this.polling = true;
      try {
        if (await this.poll()) onUpdate(this.snapshot());
      } finally {
        this.polling = false;
      }
    };
    void tick();
    this.timer = setInterval(tick, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Reads whatever is new. Returns true when something changed. */
  async poll(): Promise<boolean> {
    let changed = false;

    for (const entry of await this.mainTail.readNew()) {
      changed = true;
      this.cwd ??= cwdOf(entry);
      this.push(applyEntry(this.main, entry, { skipSidechain: true }));
    }

    for (const id of await this.listSubagentIds()) {
      if (!this.agents.has(id)) {
        changed = true;
        this.agents.set(id, {
          state: newAgentState(id, "subagent", 1),
          tail: new JsonlTail(join(this.subagentsDir, `agent-${id}.jsonl`)),
          metaPath: join(this.subagentsDir, `agent-${id}.meta.json`),
        });
      }
    }

    for (const tracked of this.agents.values()) {
      if (await this.refreshMeta(tracked)) changed = true;
      for (const entry of await tracked.tail.readNew()) {
        changed = true;
        this.push(applyEntry(tracked.state, entry));
      }
    }
    return changed;
  }

  snapshot(): SessionSnapshot {
    const agents = [...this.agents.values()]
      .map((t) => t.state)
      .sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity));
    return {
      sessionId: this.sessionId,
      transcriptPath: this.transcriptPath,
      cwd: this.cwd,
      main: this.main,
      agents,
      events: this.events,
    };
  }

  private push(events: LogEvent[]): void {
    if (events.length === 0) return;
    this.events = [...this.events, ...events].sort((a, b) => a.at - b.at).slice(-MAX_EVENTS);
  }

  private async listSubagentIds(): Promise<string[]> {
    try {
      const names = await readdir(this.subagentsDir);
      return names.flatMap((n) => {
        const m = /^agent-(.+)\.jsonl$/.exec(n);
        return m?.[1] ? [m[1]] : [];
      });
    } catch {
      return [];
    }
  }

  /** Applies the subagent's .meta.json (label, type, model, finished). */
  private async refreshMeta(tracked: Tracked): Promise<boolean> {
    const s = tracked.state;
    if (s.status === "done") return false;
    let meta: SubagentMeta;
    try {
      meta = JSON.parse(await readFile(tracked.metaPath, "utf8")) as SubagentMeta;
    } catch {
      return false;
    }
    const before = `${s.label}|${s.agentType}|${s.status}|${s.model}`;
    s.label = meta.description || meta.agentType || s.label;
    s.agentType = meta.agentType ?? s.agentType;
    s.depth = meta.spawnDepth ?? s.depth;
    s.spawnToolUseId = meta.toolUseId ?? s.spawnToolUseId;
    s.model ??= meta.pickedEffortModel;
    if (meta.finished) {
      s.status = "done";
      s.activity = "done";
      s.pendingTools.clear();
      this.push([{ at: s.lastActivityAt ?? Date.now(), agentId: s.id, text: "✓ finished" }]);
    }
    return before !== `${s.label}|${s.agentType}|${s.status}|${s.model}`;
  }
}

function cwdOf(entry: unknown): string | undefined {
  if (typeof entry === "object" && entry !== null && "cwd" in entry) {
    const cwd = (entry as { cwd: unknown }).cwd;
    return typeof cwd === "string" ? cwd : undefined;
  }
  return undefined;
}

/** The most recently written main transcript across all projects. */
export async function findLatestTranscript(projectsDir = PROJECTS_DIR): Promise<string | undefined> {
  let best: { path: string; mtime: number } | undefined;
  for (const project of await safeReaddir(projectsDir)) {
    const dir = join(projectsDir, project);
    for (const name of await safeReaddir(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(dir, name);
      try {
        const { mtimeMs } = await stat(path);
        if (!best || mtimeMs > best.mtime) best = { path, mtime: mtimeMs };
      } catch {
        // vanished between readdir and stat
      }
    }
  }
  return best?.path;
}

/** Finds `<sessionId>.jsonl` in any project folder. */
export async function findTranscriptById(sessionId: string, projectsDir = PROJECTS_DIR): Promise<string | undefined> {
  for (const project of await safeReaddir(projectsDir)) {
    const path = join(projectsDir, project, `${sessionId}.jsonl`);
    try {
      await stat(path);
      return path;
    } catch {
      // not in this project
    }
  }
  return undefined;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
