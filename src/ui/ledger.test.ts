import { describe, expect, it } from "vitest";
import { type AgentState, newAgentState } from "../transcript/agent-state.js";
import { buildLedger } from "./ledger.js";

function agent(id: string, status: AgentState["status"], t: number, input: number, output: number): AgentState {
  const a = newAgentState(id, `task ${id}`, 1);
  a.status = status;
  a.startedAt = t;
  a.lastActivityAt = t + 10;
  a.tokens = { input, cacheRead: input * 10, cacheWrite: input * 2, output };
  return a;
}

describe("buildLedger", () => {
  const main = agent("main", "running", 0, 100, 50);
  const agents = [
    agent("a", "done", 1, 1, 1),
    agent("b", "running", 2, 2, 2),
    agent("c", "done", 3, 3, 3),
    agent("d", "idle", 4, 4, 4),
  ];

  it("totals every agent, finished ones included", () => {
    const l = buildLedger(main, agents);
    expect(l.total.tokens).toEqual({ input: 110, cacheRead: 1100, cacheWrite: 220, output: 60 });
    expect(l.total.total).toBe(110 + 1100 + 220 + 60);
    expect(l.rows).toHaveLength(5);
    expect(l.rest).toBeUndefined();
  });

  it("lists main, then active agents, then newest finished, and sums the rest", () => {
    const l = buildLedger(main, agents, 3);
    expect(l.rows.map((r) => r.id)).toEqual(["main", "b", "d", "c"]);
    expect(l.rest).toMatchObject({ count: 1, label: "+1 more", tokens: { input: 1, output: 1 } });
    // The total doesn't change when rows are collapsed.
    expect(l.total.total).toBe(buildLedger(main, agents).total.total);
  });

  it("copies token values instead of sharing them with agent state", () => {
    const l = buildLedger(main, []);
    l.rows[0]!.tokens.input = 999;
    expect(main.tokens.input).toBe(100);
  });
});
