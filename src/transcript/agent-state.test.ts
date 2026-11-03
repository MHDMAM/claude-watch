import { describe, expect, it } from "vitest";
import { applyEntry, describeTool, newAgentState, totalTokens } from "./agent-state.js";

const usage = (input: number, read: number, write: number, output: number) => ({
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  output_tokens: output,
});

const assistant = (id: string, content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  timestamp: "2026-11-03T04:36:52.231Z",
  message: { id, model: "claude-haiku-5-5", content, usage: usage(2, 100, 50, 10), ...extra },
});

const toolResult = (toolUseId: string) => ({
  type: "user",
  timestamp: "2026-11-03T04:36:55.000Z",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }] },
});

describe("applyEntry", () => {
  it("counts a reply split over several lines only once", () => {
    const s = newAgentState("a1", "search");
    applyEntry(s, assistant("msg_1", [{ type: "thinking", thinking: "" }]));
    applyEntry(s, assistant("msg_1", [{ type: "tool_use", id: "t1", name: "Grep", input: { pattern: "login(" } }]));
    expect(totalTokens(s.tokens)).toBe(162);
    expect(s.contextTokens).toBe(152);
    expect(s.model).toBe("claude-haiku-5-5");
  });

  it("sums tokens across different replies", () => {
    const s = newAgentState("a1", "search");
    applyEntry(s, assistant("msg_1", []));
    applyEntry(s, assistant("msg_2", []));
    expect(s.tokens).toEqual({ input: 4, cacheRead: 200, cacheWrite: 100, output: 20 });
  });

  it("tracks the running tool and clears it when the result arrives", () => {
    const s = newAgentState("a1", "search");
    const events = applyEntry(
      s,
      assistant("msg_1", [{ type: "tool_use", id: "t1", name: "Grep", input: { pattern: "login(" } }], {
        stop_reason: "tool_use",
      }),
    );
    expect(s.activity).toBe("Grep login(");
    expect(s.status).toBe("running");
    expect(s.toolCalls).toBe(1);
    expect(events.map((e) => e.text)).toEqual(["→ Grep login("]);

    applyEntry(s, toolResult("t1"));
    expect(s.pendingTools.size).toBe(0);
    expect(s.activity).toBe("thinking");
  });

  it("goes idle on end_turn and wakes on a typed prompt", () => {
    const s = newAgentState("main", "main");
    applyEntry(s, assistant("msg_1", [{ type: "text", text: "done" }], { stop_reason: "end_turn" }));
    expect(s.status).toBe("idle");

    const events = applyEntry(s, { type: "user", message: { role: "user", content: "next task please" } });
    expect(s.status).toBe("running");
    expect(events[0]?.text).toBe("prompt: next task please");
  });

  it("ignores system meta prompts", () => {
    const s = newAgentState("main", "main");
    applyEntry(s, assistant("msg_1", [], { stop_reason: "end_turn" }));
    expect(applyEntry(s, { type: "user", isMeta: true, message: { content: "<system>" } })).toEqual([]);
    expect(s.status).toBe("idle");
  });

  it("does not change a finished agent's status", () => {
    const s = newAgentState("a1", "audit");
    s.status = "done";
    applyEntry(s, toolResult("t9"));
    expect(s.status).toBe("done");
  });

  it("skips sidechain entries when asked", () => {
    const s = newAgentState("main", "main");
    applyEntry(s, { ...assistant("msg_1", []), isSidechain: true }, { skipSidechain: true });
    expect(totalTokens(s.tokens)).toBe(0);
  });
});

describe("describeTool", () => {
  it("summarises common tools", () => {
    expect(describeTool("Read", { file_path: "/a/b/auth.ts" })).toBe("Read auth.ts");
    expect(describeTool("Bash", { command: "git diff", description: "Show diff" })).toBe("Bash Show diff");
    expect(describeTool("Agent", { description: "Map the repo", prompt: "..." })).toBe("Agent Map the repo");
    expect(describeTool("Mystery", {})).toBe("Mystery");
  });
});
