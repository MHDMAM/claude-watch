import { Box, Text, useApp, useInput, useStdout } from "ink";
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

const SPINNER = ["◐", "◓", "◑", "◒"];
const BOX_WIDTH = 30;
const LOG_LINES = 8;

export function App({ watcher, intervalMs }: { watcher: SessionWatcher; intervalMs: number }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [snap, setSnap] = useState<SessionSnapshot>(() => watcher.snapshot());
  const [tick, setTick] = useState(0);
  const [columns, setColumns] = useState(stdout.columns || 100);

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

  useInput((input) => {
    if (input === "q") exit();
  });

  const now = Date.now();
  const width = Math.max(40, columns - 2);
  const all = [snap.main, ...snap.agents];
  const grand = all.reduce((sum, a) => sum + totalTokens(a.tokens), 0);
  const running = snap.agents.filter((a) => a.status === "running").length;
  const labels = new Map(all.map((a) => [a.id, a]));
  const perRow = Math.max(1, Math.floor(width / (BOX_WIDTH + 1)));
  const spinner = SPINNER[tick % SPINNER.length] ?? "◐";

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

      <Box flexWrap="wrap" columnGap={1} width={width} justifyContent={snap.agents.length < perRow ? "center" : "flex-start"}>
        {snap.agents.map((a) => (
          <AgentBox key={a.id} agent={a} now={now} spinner={spinner} width={BOX_WIDTH} />
        ))}
      </Box>

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
        <Text dimColor>q quit</Text>
        <Text>
          <Text dimColor>agents </Text>
          {running}/{snap.agents.length}
          <Text dimColor> · total tokens </Text>
          <Text bold>{formatTokens(grand)}</Text>
        </Text>
      </Box>
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
