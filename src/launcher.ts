import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config, Placement } from "./config.js";

const run = promisify(execFile);

export interface LaunchContext {
  /** The watcher command as argv: [node, cli.js, transcript]. */
  argv: string[];
  platform: NodeJS.Platform;
  /** $TERM_PROGRAM of the Claude session, e.g. "iTerm.app" or "Apple_Terminal". */
  termProgram?: string;
  /** $ITERM_SESSION_ID of the Claude session, e.g. "w0t0p0:9F1C…". */
  itermSessionId?: string;
  /** $WT_SESSION: set when Claude runs inside Windows Terminal. */
  wtSession?: string;
}

export interface LaunchPlan {
  file: string;
  args: string[];
  /** Pass args to the Windows process exactly as given (needed for cmd.exe). */
  verbatim?: boolean;
}

export interface LaunchResult {
  placement?: Placement;
  /** Why each attempted placement failed, in order. */
  errors: string[];
}

const TITLE = "claude-watch";

/** Escapes a string for use inside an AppleScript string literal. */
export function asString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Quotes a value for a POSIX shell. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** How to open the watcher with one placement on this platform, or why it can't. */
export function buildPlan(placement: Placement, ctx: LaunchContext, config: Config): LaunchPlan | Error {
  if (ctx.platform === "darwin") {
    const script = buildScript(placement, ctx, config);
    return script instanceof Error ? script : { file: "osascript", args: ["-e", script] };
  }
  if (ctx.platform === "win32") return buildWindowsPlan(placement, ctx, config);
  return new Error(`opening a terminal automatically is not supported on ${ctx.platform}`);
}

/* ------------------------------- macOS ------------------------------- */

/** Builds the AppleScript for one placement, or explains why it can't be used. */
export function buildScript(placement: Placement, ctx: LaunchContext, config: Config): string | Error {
  // Leading space keeps it out of shell history; exec closes the pane on quit.
  const cmd = asString(` exec ${ctx.argv.map(shQuote).join(" ")}`);
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

/* ------------------------------ Windows ------------------------------ */

/** Quotes one argument for cmd.exe `start`. Windows paths can't contain `"`. */
function cmdQuote(s: string): string {
  return `"${s.replace(/"/g, "")}"`;
}

/**
 * Windows Terminal (`wt.exe`) can split or add a tab to the window Claude is
 * in (`-w 0`) when Claude runs inside it. Anywhere else (plain PowerShell
 * console, Git Bash's mintty window) a new console window is opened.
 */
export function buildWindowsPlan(placement: Placement, ctx: LaunchContext, config: Config): LaunchPlan | Error {
  if (placement === "window") {
    // cmd /s strips the outer quotes; `start` takes the first quoted arg as the title.
    const line = `"start ${cmdQuote(TITLE)} ${ctx.argv.map(cmdQuote).join(" ")}"`;
    return { file: "cmd.exe", args: ["/d", "/s", "/c", line], verbatim: true };
  }

  if (!ctx.wtSession) return new Error(`${placement} needs Windows Terminal`);

  if (placement === "split") {
    const vertical = config.splitDirection === "vertical";
    return {
      file: "wt.exe",
      args: [
        "-w", "0", "split-pane", vertical ? "-V" : "-H", "--title", TITLE, ...ctx.argv,
        ...(config.keepFocus ? [";", "move-focus", vertical ? "left" : "up"] : []),
      ],
    };
  }

  return {
    file: "wt.exe",
    args: [
      "-w", "0", "new-tab", "--title", TITLE, ...ctx.argv,
      ...(config.keepFocus ? [";", "focus-tab", "--previous"] : []),
    ],
  };
}

/* ------------------------------- launch ------------------------------ */

/** Tries each configured placement in order until one succeeds. */
export async function launch(ctx: LaunchContext, config: Config): Promise<LaunchResult> {
  const errors: string[] = [];
  for (const placement of config.placement) {
    const plan = buildPlan(placement, ctx, config);
    if (plan instanceof Error) {
      errors.push(`${placement}: ${plan.message}`);
      continue;
    }
    try {
      await run(plan.file, plan.args, { timeout: 10_000, windowsVerbatimArguments: plan.verbatim });
      return { placement, errors };
    } catch (err) {
      errors.push(`${placement}: ${err instanceof Error ? err.message.trim() : String(err)}`);
    }
  }
  return { errors };
}
