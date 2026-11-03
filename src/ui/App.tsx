import { Box, Text, useApp, useInput, useStdin, useStdout } from "ink";
import { useEffect, useState } from "react";
import type { SessionSnapshot, SessionWatcher } from "../session.js";
import { type AgentState, totalTokens } from "../transcript/agent-state.js";
import {
  clock,
  elapsed,
  FAMILY_COLOR,
  formatTokens,
  modelFamily,
  shortModel,
  truncate,
} from "./format.js";
import { buildLedger, type LedgerRow } from "./ledger.js";

const SPINNER = ["◐", "◓", "◑", "◒"];
const BOX_WIDTH = 30;
const LOG_LINES = 8;
/** Agents listed individually in the compact ledger; the rest are summed. */
const LEDGER_ROWS = 6;

export function App({ watcher, intervalMs }: { watcher: SessionWatcher; intervalMs: number }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [snap, setSnap] = useState<SessionSnapshot>(() => watcher.snapshot());
  const [tick, setTick] = useState(0);
  const [columns, setColumns] = useState(stdout.columns || 100);
  const [fullLedger, setFullLedger] = useState(false);

  useEffect(() => {
    watcher.start(intervalMs, (s) => setSnap({ ...s, agents: [...s.agents], events: [...s.events] }));
    const spin = setInterval(() => setTick((t) => t + 1), 250);
    const onResize = () => setColumns(stdout.columns || 100);
    stdout.on("resize", onResize);
    return () => {
      watcher.stop();
      clearInterval(spin);
      stdout.off("resize", onResize);
    };
  }, [watcher, intervalMs, stdout]);

  // Git Bash's mintty window has no raw mode: skip keys there (Ctrl+C still quits).
  // Ink reports stdin.isTTY here, which is undefined (not false) for pipes.
  const isRawModeSupported = useStdin().isRawModeSupported === true;
  useInput(
    (input) => {
      if (input === "q") exit();
      if (input === "t") setFullLedger((v) => !v);
    },
    { isActive: isRawModeSupported },
  );
  const keysHint = isRawModeSupported ? "q quit · t all agents' tokens" : "Ctrl+C quit";

  const now = Date.now();
  const width = Math.max(40, columns - 2);
  const all = [snap.main, ...snap.agents];
  const running = snap.agents.filter((a) => a.status === "running").length;
  const labels = new Map(all.map((a) => [a.id, a]));
  const perRow = Math.max(1, Math.floor(width / (BOX_WIDTH + 1)));
  const spinner = SPINNER[tick % SPINNER.length] ?? "◐";
  const ledger = buildLedger(snap.main, snap.agents, fullLedger ? Infinity : LEDGER_ROWS);

  // Boxes: every active agent, plus the newest finished ones to fill the last row.
  const active = snap.agents.filter((a) => a.status !== "done");
  const done = snap.agents
    .filter((a) => a.status === "done")
    .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  const doneSlots = perRow - (active.length % perRow); // fill the last row (or one full row)
  const keepDone = new Set(done.slice(0, doneSlots).map((a) => a.id));
  const boxes = snap.agents.filter((a) => a.status !== "done" || keepDone.has(a.id));
  const hiddenDone = done.length - keepDone.size;

  if (fullLedger) {
    return (
      <Box flexDirection="column" width={width}>
        <Box justifyContent="space-between">
          <Text bold>
            TOKEN LEDGER <Text dimColor>· all {all.length} agents</Text>
          </Text>
          <Text dimColor>session {snap.sessionId.slice(0, 8)}</Text>
        </Box>
        <LedgerTable ledger={ledger} width={width} spinner={spinner} />
        <Text dimColor>{isRawModeSupported ? "t back · q quit" : "Ctrl+C quit"}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="space-between">
        <Text bold>
          CLAUDE WATCH <Text dimColor>· {truncate(snap.cwd ?? snap.transcriptPath, Math.max(10, width - 50))}</Text>
        </Text>
        <Text dimColor>session {snap.sessionId.slice(0, 8)}</Text>
      </Box>
      <Text dimColor>{"─".repeat(width)}</Text>

      <Box justifyContent="center">
        <AgentBox agent={snap.main} now={now} spinner={spinner} width={Math.min(width, 54)} isMain />
      </Box>

      {snap.agents.length > 0 && (
        <Box flexDirection="column" alignItems="center">
          <Text color="gray">│</Text>
          <Text>
            delegated to <Text bold>{snap.agents.length}</Text> subagent{snap.agents.length === 1 ? "" : "s"}
            <Text dimColor> · {running} running</Text>
          </Text>
          <Text color="gray">▼</Text>
        </Box>
      )}

      <Box flexWrap="wrap" columnGap={1} width={width} justifyContent={boxes.length < perRow ? "center" : "flex-start"}>
        {boxes.map((a) => (
          <AgentBox key={a.id} agent={a} now={now} spinner={spinner} width={BOX_WIDTH} />
        ))}
      </Box>
      {hiddenDone > 0 && (
        <Box justifyContent="center">
          <Text dimColor>
            + {hiddenDone} earlier finished agent{hiddenDone === 1 ? "" : "s"} (still counted in the token ledger)
          </Text>
        </Box>
      )}

      <LedgerTable ledger={ledger} width={width} spinner={spinner} />

      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
        <Text dimColor>session log</Text>
        {snap.events.length === 0 && <Text dimColor>waiting for activity…</Text>}
        {snap.events.slice(-LOG_LINES).map((e, i) => {
          const agent = labels.get(e.agentId);
          const name = agent?.id === "main" ? "main" : (agent?.label ?? e.agentId);
          return (
            <Text key={`${e.at}-${i}`} wrap="truncate-end">
              <Text dimColor>{clock(e.at)} </Text>
              <Text color={FAMILY_COLOR[modelFamily(agent?.model)]}>{truncate(name, 16).padEnd(16)} </Text>
              {e.text}
            </Text>
          );
        })}
      </Box>

      <Box justifyContent="space-between">
        <Text dimColor>{keysHint}</Text>
        <Text>
          <Text dimColor>agents </Text>
          {running}/{snap.agents.length}
          <Text dimColor> running · in </Text>
          {formatTokens(ledger.total.tokens.input + ledger.total.tokens.cacheRead + ledger.total.tokens.cacheWrite)}
          <Text dimColor> · out </Text>
          {formatTokens(ledger.total.tokens.output)}
          <Text dimColor> · total </Text>
          <Text bold>{formatTokens(ledger.total.total)}</Text>
        </Text>
      </Box>
    </Box>
  );
}

const NUM = 9;
const COLUMNS: Array<[string, (r: LedgerRow) => number]> = [
  ["in", (r) => r.tokens.input],
  ["cache rd", (r) => r.tokens.cacheRead],
  ["cache wr", (r) => r.tokens.cacheWrite],
  ["out", (r) => r.tokens.output],
  ["total", (r) => r.total],
];

function LedgerTable({ ledger, width, spinner }: { ledger: ReturnType<typeof buildLedger>; width: number; spinner: string }) {
  const nameWidth = Math.max(10, width - 4 - 2 - COLUMNS.length * NUM);
  const nums = (r: LedgerRow) => COLUMNS.map(([, get]) => formatTokens(get(r)).padStart(NUM)).join("");

  const line = (r: LedgerRow, opts: { bold?: boolean; dim?: boolean } = {}) => {
    const icon = r.status === "done" ? "✓" : r.status === "idle" ? "○" : r.status === "running" ? spinner : " ";
    const color = r.id === "total" || r.id === "rest" ? undefined : FAMILY_COLOR[modelFamily(r.model)];
    return (
      <Text key={r.id} wrap="truncate-end" bold={opts.bold} dimColor={opts.dim}>
        <Text color={r.status === "done" ? "green" : color}>{icon} </Text>
        <Text color={color}>{truncate(r.label, nameWidth).padEnd(nameWidth)}</Text>
        {nums(r)}
      </Text>
    );
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text dimColor wrap="truncate-end">
        {"  "}
        {"token ledger".padEnd(nameWidth)}
        {COLUMNS.map(([h]) => h.padStart(NUM)).join("")}
      </Text>
      {ledger.rows.map((r) => line(r))}
      {ledger.rest && line(ledger.rest, { dim: true })}
      <Text dimColor>{"─".repeat(Math.max(0, width - 4))}</Text>
      {line(ledger.total, { bold: true })}
    </Box>
  );
}

function AgentBox(props: { agent: AgentState; now: number; spinner: string; width: number; isMain?: boolean }) {
  const { agent: a, now, spinner, width, isMain } = props;
  const color = FAMILY_COLOR[modelFamily(a.model)];
  const inner = width - 4;
  const icon = a.status === "done" ? "✓" : a.status === "idle" ? "○" : spinner;
  const iconColor = a.status === "done" ? "green" : a.status === "idle" ? "gray" : color;
  const title = isMain ? "main session" : a.label;
  const subtitle = [a.agentType, shortModel(a.model)].filter(Boolean).join(" · ");

  return (
    <Box
      flexDirection="column"
      borderStyle={isMain ? "double" : "round"}
      borderColor={a.status === "done" ? "gray" : color}
      paddingX={1}
      width={width}
    >
      <Text bold color={color} wrap="truncate-end">
        {truncate(title, inner)}
      </Text>
      <Text dimColor wrap="truncate-end">
        {truncate(subtitle, inner)}
      </Text>
      <Text wrap="truncate-end">
        <Text color={iconColor}>{icon} </Text>
        {truncate(a.activity, inner - 2)}
      </Text>
      <Text wrap="truncate-end">
        <Text bold>{formatTokens(totalTokens(a.tokens))}</Text>
        <Text dimColor>{truncate(` tok · ctx ${formatTokens(a.contextTokens)}`, inner - 6)}</Text>
      </Text>
      <Text dimColor wrap="truncate-end">
        {truncate(`${a.toolCalls} tools · ${elapsed(a, now)}`, inner)}
      </Text>
    </Box>
  );
}
