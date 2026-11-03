import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config, Placement } from "./config.js";

const run = promisify(execFile);

export interface LaunchContext {
  /** Shell command to run in the new pane/tab/window. */
  command: string;
  /** $TERM_PROGRAM of the Claude session, e.g. "iTerm.app" or "Apple_Terminal". */
  termProgram?: string;
  /** $ITERM_SESSION_ID of the Claude session, e.g. "w0t0p0:9F1C…". */
  itermSessionId?: string;
}

export interface LaunchResult {
  placement?: Placement;
  /** Why each attempted placement failed, in order. */
  errors: string[];
}

/** Escapes a string for use inside an AppleScript string literal. */
export function asString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Quotes a value for a POSIX shell. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Builds the AppleScript for one placement, or explains why it can't be used. */
export function buildScript(placement: Placement, ctx: LaunchContext, config: Config): string | Error {
  const cmd = asString(ctx.command);
  const isIterm = ctx.termProgram === "iTerm.app";
  const uuid = ctx.itermSessionId?.split(":").at(-1);

  if (!isIterm) {
    if (placement === "split") return new Error("split needs iTerm2");
    // Terminal.app (or unknown): a new window is the only reliable option.
    return `tell application "Terminal"\n  do script ${cmd}\n  activate\nend tell`;
  }

  if (placement === "window") {
    return [
      `tell application "iTerm2"`,
      `  set newWindow to (create window with default profile)`,
      `  tell current session of newWindow to write text ${cmd}`,
      `end tell`,
    ].join("\n");
  }

  if (!uuid) return new Error(`${placement} needs ITERM_SESSION_ID`);

  // Find the window/tab/session Claude is running in.
  const find = [
    `tell application "iTerm2"`,
    `  repeat with w in windows`,
    `    repeat with t in tabs of w`,
    `      repeat with s in sessions of t`,
    `        if unique id of s is ${asString(uuid)} then`,
  ];
  const done = [
    `          return "ok"`,
    `        end if`,
    `      end repeat`,
    `    end repeat`,
    `  end repeat`,
    `  error "Claude's iTerm2 session was not found"`,
    `end tell`,
  ];

  const body =
    placement === "split"
      ? [
          `          tell s to set newSession to (split ${config.splitDirection}ly with default profile)`,
          `          tell newSession to write text ${cmd}`,
          ...(config.keepFocus ? [`          tell s to select`] : []),
        ]
      : [
          `          tell w to set newTab to (create tab with default profile)`,
          `          tell current session of newTab to write text ${cmd}`,
          ...(config.keepFocus ? [`          tell t to select`, `          tell s to select`] : []),
        ];

  return [...find, ...body, ...done].join("\n");
}

/** Tries each configured placement in order until one succeeds. */
export async function launch(ctx: LaunchContext, config: Config): Promise<LaunchResult> {
  const errors: string[] = [];
  for (const placement of config.placement) {
    const script = buildScript(placement, ctx, config);
    if (script instanceof Error) {
      errors.push(`${placement}: ${script.message}`);
      continue;
    }
    try {
      await run("osascript", ["-e", script], { timeout: 10_000 });
      return { placement, errors };
    } catch (err) {
      errors.push(`${placement}: ${err instanceof Error ? err.message.trim() : String(err)}`);
    }
  }
  return { errors };
}
