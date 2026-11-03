import { type AgentState, type AgentStatus, type TokenTotals, totalTokens } from "../transcript/agent-state.js";

/**
 * Token ledger: running totals of input / cache read / cache write / output
 * per agent, plus a grand total that always includes every agent, even
 * finished ones that no longer have a box on screen.
 */

export interface LedgerRow {
  id: string;
  label: string;
  status?: AgentStatus;
  model?: string;
  tokens: TokenTotals;
  total: number;
}

export interface Ledger {
  rows: LedgerRow[];
  /** Agents not listed individually, summed into one row. */
  rest?: LedgerRow & { count: number };
  total: LedgerRow;
}

const zero = (): TokenTotals => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });

export function addTokens(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}

function row(a: AgentState): LedgerRow {
  return {
    id: a.id,
    label: a.id === "main" ? "main" : a.label,
    status: a.status,
    model: a.model,
    tokens: { ...a.tokens },
    total: totalTokens(a.tokens),
  };
}

function sum(id: string, label: string, rows: LedgerRow[]): LedgerRow {
  const tokens = rows.reduce((acc, r) => addTokens(acc, r.tokens), zero());
  return { id, label, tokens, total: totalTokens(tokens) };
}

/**
 * Builds the ledger. With `maxAgents`, the main session and active agents are
 * listed first, then the most recently finished; the rest are summed into
 * `rest`. The total row always covers everything.
 */
export function buildLedger(main: AgentState, agents: AgentState[], maxAgents = Infinity): Ledger {
  const ordered = [...agents].sort((a, b) => {
    const aDone = a.status === "done" ? 1 : 0;
    const bDone = b.status === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone; // active first
    if (aDone) return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0); // newest finished first
    return (a.startedAt ?? 0) - (b.startedAt ?? 0);
  });
  const shown = ordered.slice(0, Math.max(0, maxAgents)).map(row);
  const hidden = ordered.slice(shown.length).map(row);
  const all = [row(main), ...agents.map(row)];

  return {
    rows: [row(main), ...shown],
    rest: hidden.length
      ? { ...sum("rest", `+${hidden.length} more`, hidden), count: hidden.length }
      : undefined,
    total: sum("total", "total", all),
  };
}
