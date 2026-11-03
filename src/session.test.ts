import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findLatestTranscript, findTranscriptById, SessionWatcher } from "./session.js";

const line = (o: unknown) => `${JSON.stringify(o)}\n`;

const reply = (id: string, model: string, ts: string, content: unknown[] = []) =>
  line({
    type: "assistant",
    timestamp: ts,
    cwd: "/repo",
    message: { id, model, content, usage: { input_tokens: 1, output_tokens: 9 } },
  });

async function fixture() {
  const projects = await mkdtemp(join(tmpdir(), "claude-watch-projects-"));
  const dir = join(projects, "-repo");
  await mkdir(join(dir, "s1", "subagents"), { recursive: true });
  const main = join(dir, "s1.jsonl");
  await writeFile(main, reply("m1", "claude-opus-5-5", "2026-11-03T01:00:00Z"));
  return { projects, main, sub: join(dir, "s1", "subagents") };
}

describe("SessionWatcher", () => {
  it("picks up the main agent and subagents as their files appear", async () => {
    const { main, sub } = await fixture();
    const w = new SessionWatcher(main);

    expect(await w.poll()).toBe(true);
    let snap = w.snapshot();
    expect(snap.sessionId).toBe("s1");
    expect(snap.cwd).toBe("/repo");
    expect(snap.main.model).toBe("claude-opus-5-5");
    expect(snap.agents).toHaveLength(0);

    await writeFile(join(sub, "agent-a1.meta.json"), JSON.stringify({ agentType: "Explore", description: "map repo" }));
    await writeFile(
      join(sub, "agent-a1.jsonl"),
      reply("s1m1", "claude-haiku-5-5", "2026-11-03T01:00:05Z", [
        { type: "tool_use", id: "t1", name: "Glob", input: { pattern: "**/*.ts" } },
      ]),
    );
    await w.poll();
    snap = w.snapshot();
    expect(snap.agents).toHaveLength(1);
    expect(snap.agents[0]).toMatchObject({ label: "map repo", agentType: "Explore", status: "running" });
    expect(snap.agents[0]?.activity).toBe("Glob **/*.ts");
    expect(snap.events.at(-1)?.text).toBe("→ Glob **/*.ts");

    await writeFile(join(sub, "agent-a1.meta.json"), JSON.stringify({ description: "map repo", finished: true }));
    await w.poll();
    expect(w.snapshot().agents[0]?.status).toBe("done");
  });

  it("reports no change when nothing new was written", async () => {
    const { main } = await fixture();
    const w = new SessionWatcher(main);
    await w.poll();
    expect(await w.poll()).toBe(false);
    await appendFile(main, reply("m2", "claude-opus-5-5", "2026-11-03T01:00:09Z"));
    expect(await w.poll()).toBe(true);
  });
});

describe("transcript lookup", () => {
  it("finds a session by id and the latest session", async () => {
    const { projects, main } = await fixture();
    expect(await findTranscriptById("s1", projects)).toBe(main);
    expect(await findTranscriptById("nope", projects)).toBeUndefined();
    expect(await findLatestTranscript(projects)).toBe(main);
  });
});
