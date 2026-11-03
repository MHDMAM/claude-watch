import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Placement = "split" | "tab" | "window";

export interface Config {
  /** Set to false to stop the hook from opening the watcher. */
  enabled: boolean;
  /** Tried in order until one works. */
  placement: Placement[];
  /** Direction of the iTerm2 split. "vertical" puts the watcher on the right. */
  splitDirection: "vertical" | "horizontal";
  /** Open once this many subagents are running at the same time. */
  minSubagents: number;
  /** Give keyboard focus back to the Claude pane after opening a split or tab. */
  keepFocus: boolean;
  /** How often the watcher checks the logs, in milliseconds. */
  intervalMs: number;
}

export const DEFAULT_CONFIG: Config = {
  enabled: true,
  placement: ["split", "tab", "window"],
  splitDirection: "vertical",
  minSubagents: 1,
  keepFocus: true,
  intervalMs: 500,
};

/** The repo root (one level above dist/ or src/). */
export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

export function configPath(): string {
  return process.env.CLAUDE_WATCH_CONFIG ?? join(APP_DIR, "config.json");
}

/** Reads the user's config; missing or invalid values fall back to defaults. */
export function loadConfig(path = configPath()): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  return mergeConfig(raw);
}

export function mergeConfig(raw: unknown): Config {
  const c = { ...DEFAULT_CONFIG, placement: [...DEFAULT_CONFIG.placement] };
  if (typeof raw !== "object" || raw === null) return c;
  const r = raw as Record<string, unknown>;

  if (typeof r.enabled === "boolean") c.enabled = r.enabled;
  if (typeof r.keepFocus === "boolean") c.keepFocus = r.keepFocus;
  if (r.splitDirection === "vertical" || r.splitDirection === "horizontal") c.splitDirection = r.splitDirection;
  if (typeof r.minSubagents === "number" && r.minSubagents >= 1) c.minSubagents = Math.floor(r.minSubagents);
  if (typeof r.intervalMs === "number" && r.intervalMs >= 100) c.intervalMs = r.intervalMs;

  const placement = typeof r.placement === "string" ? [r.placement] : r.placement;
  if (Array.isArray(placement)) {
    const valid = placement.filter((p): p is Placement => p === "split" || p === "tab" || p === "window");
    if (valid.length > 0) c.placement = [...new Set(valid)];
  }
  return c;
}
