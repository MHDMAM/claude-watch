import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "./config.js";
import { claimSession, countRunningSubagents, handleHook, type HookDeps, mainTranscriptFor } from "./hook.js";

async function session() {
  const root = await mkdtemp(join(tmpdir(), "cw-hook-"));
  const transcript = join(root, "s1.jsonl");
  const sub = join(root, "s1", "subagents");
  await mkdir(sub, { recursive: true });
  await writeFile(transcript, "");
  return { root, transcript, sub, stateDir: join(root, "state") };
}

function deps(stateDir: string, overrides: Partial<HookDeps> = {}): HookDeps {
  return {
    config: DEFAULT_CONFIG,
    env: { TERM_PROGRAM: "iTerm.app", ITERM_SESSION_ID: "w0t0p0:ABC" },
    stateDir,
    launch: vi.fn(async () => ({ placement: "split" as const, errors: [] })),
    log: () => {},
    ...overrides,
  };
}

describe("mainTranscriptFor", () => {
  it("maps a subagent transcript to its session transcript", () => {
    expect(mainTranscriptFor("/p/proj/s1/subagents/agent-a1.jsonl")).toBe("/p/proj/s1.jsonl");
    expect(mainTranscriptFor("/p/proj/s1.jsonl")).toBe("/p/proj/s1.jsonl");
  });
});

describe("countRunningSubagents", () => {
  it("counts unfinished agents plus the one starting now", async () => {
    const { transcript, sub } = await session();
    await writeFile(join(sub, "agent-a.meta.json"), JSON.stringify({ finished: false }));
    await writeFile(join(sub, "agent-b.meta.json"), JSON.stringify({ finished: true }));
    expect(countRunningSubagents(transcript)).toBe(1);
    expect(countRunningSubagents(transcript, "c")).toBe(2);
    expect(countRunningSubagents(transcript, "a")).toBe(1);
  });
});

describe("claimSession", () => {
  it("succeeds only once per session", async () => {
    const { stateDir } = await session();
    expect(claimSession("s1", stateDir)).toBe(true);
    expect(claimSession("s1", stateDir)).toBe(false);
    expect(claimSession("s2", stateDir)).toBe(true);
  });
});

describe("handleHook", () => {
  it("opens the watcher once when a subagent starts", async () => {
    const { transcript, stateDir } = await session();
    const d = deps(stateDir);
    const input = { hook_event_name: "SubagentStart", session_id: "s1", transcript_path: transcript, agent_id: "a" };
    await handleHook(input, d);
    await handleHook({ ...input, agent_id: "b" }, d);
    expect(d.launch).toHaveBeenCalledTimes(1);
    const [ctx] = vi.mocked(d.launch).mock.calls[0]!;
    expect(ctx.command).toContain(transcript);
    expect(ctx.itermSessionId).toBe("w0t0p0:ABC");
  });

  it("waits for the configured number of running subagents", async () => {
    const { transcript, sub, stateDir } = await session();
    const d = deps(stateDir, { config: { ...DEFAULT_CONFIG, minSubagents: 2 } });
    const input = { hook_event_name: "SubagentStart", session_id: "s1", transcript_path: transcript };
    await handleHook({ ...input, agent_id: "a" }, d);
    expect(d.launch).not.toHaveBeenCalled();
    await writeFile(join(sub, "agent-a.meta.json"), JSON.stringify({ finished: false }));
    await handleHook({ ...input, agent_id: "b" }, d);
    expect(d.launch).toHaveBeenCalledTimes(1);
  });

  it("does nothing when disabled or outside a terminal", async () => {
    const { transcript, stateDir } = await session();
    const input = { hook_event_name: "SubagentStart", session_id: "s1", transcript_path: transcript, agent_id: "a" };
    const off = deps(stateDir, { config: { ...DEFAULT_CONFIG, enabled: false } });
    await handleHook(input, off);
    const headless = deps(stateDir, { env: {} });
    await handleHook(input, headless);
    expect(off.launch).not.toHaveBeenCalled();
    expect(headless.launch).not.toHaveBeenCalled();
  });
});
