import type { AgentState } from "../transcript/agent-state.js";

/** "claude-haiku-5-5" -> "haiku 5.5", "claude-opus-5-5[1m]" -> "opus 5.5" */
export function shortModel(model: string | undefined): string {
  if (!model) return "…";
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return model;
  return m[3] && m[3].length <= 2 ? `${m[1]} ${m[2]}.${m[3]}` : `${m[1]} ${m[2]}`;
}

export type Family = "opus" | "sonnet" | "haiku" | "fable" | "other";

export function modelFamily(model: string | undefined): Family {
  const m = model ?? "";
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  if (m.includes("fable")) return "fable";
  return "other";
}

export const FAMILY_COLOR: Record<Family, string> = {
  opus: "#b9a3f0",
  sonnet: "#f0a070",
  haiku: "#8fb8f5",
  fable: "#e6c26e",
  other: "gray",
};

/** 950 -> "950", 12_400 -> "12.4k", 1_250_000 -> "1.25M" */
export function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 100_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

/** 4_000 -> "4s", 95_000 -> "1m35s", 4_000_000 -> "1h06m" */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

export function elapsed(agent: AgentState, now: number): string {
  if (agent.startedAt === undefined) return "";
  const end = agent.status === "running" ? now : (agent.lastActivityAt ?? now);
  return formatDuration(end - agent.startedAt);
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", { hour12: false });
}

export function truncate(s: string, max: number): string {
  if (max <= 1) return s.slice(0, Math.max(0, max));
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
