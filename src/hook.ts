import { appendFileSync, closeSync, mkdirSync, openSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { APP_DIR, type Config, loadConfig } from "./config.js";
import { launch } from "./launcher.js";

/**
 * Claude Code `SubagentStart` hook. Opens the watcher once per session when
 * enough subagents are running. Always exits 0 and never writes to stdout,
 * so it can't block or change Claude's behaviour.
 */

export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  agent_id?: string;
}

export const STATE_DIR = join(APP_DIR, "state");

/** A subagent's own transcript path maps back to its session's main transcript. */
export function mainTranscriptFor(path: string): string {
  const m = /^(.*)[\\/]subagents[\\/][^\\/]+\.jsonl$/.exec(path);
  return m?.[1] ? `${m[1]}.jsonl` : path;
}

/** Subagents in the session whose metadata does not say they finished. */
export function countRunningSubagents(transcriptPath: string, startingAgentId?: string): number {
  const dir = join(transcriptPath.replace(/\.jsonl$/, ""), "subagents");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    names = [];
  }
  const ids = new Set<string>();
  for (const name of names) {
    const m = /^agent-(.+)\.meta\.json$/.exec(name);
    if (!m?.[1]) continue;
    try {
      const meta = JSON.parse(readFileSync(join(dir, name), "utf8")) as { finished?: boolean };
      if (meta.finished !== true) ids.add(m[1]);
    } catch {
      ids.add(m[1]); // being written right now: count it
    }
  }
  // The agent that triggered this hook may not have written its metadata yet.
  if (startingAgentId) ids.add(startingAgentId);
  return ids.size;
}

/** Atomically marks the session as opened. Returns false if it already was. */
export function claimSession(sessionId: string, stateDir = STATE_DIR): boolean {
  mkdirSync(stateDir, { recursive: true });
  try {
    closeSync(openSync(join(stateDir, `${sessionId}.opened`), "wx"));
    return true;
  } catch {
    return false;
  }
}

export interface HookDeps {
  config: Config;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  stateDir: string;
  launch: typeof launch;
  log: (line: string) => void;
}

export async function handleHook(input: HookInput, deps: HookDeps): Promise<void> {
  const { config, env, log } = deps;
  if (!config.enabled) return;
  if (input.hook_event_name && input.hook_event_name !== "SubagentStart") return;
  if (!input.transcript_path) return log("no transcript_path in hook input");
  if (!env.TERM_PROGRAM) return; // not in a terminal (SDK, CI, …): never pop windows

  const transcript = mainTranscriptFor(input.transcript_path);
  const sessionId = input.session_id ?? basename(transcript, ".jsonl");
  const running = countRunningSubagents(transcript, input.agent_id);
  if (running < config.minSubagents) return;
  if (!claimSession(sessionId, deps.stateDir)) return;

  const argv = [process.execPath, join(APP_DIR, "dist", "cli.js"), transcript];
  const result = await deps.launch(
    {
      argv,
      platform: deps.platform,
      termProgram: env.TERM_PROGRAM,
      itermSessionId: env.ITERM_SESSION_ID,
      wtSession: env.WT_SESSION,
    },
    config,
  );
  log(
    result.placement
      ? `${sessionId}: opened in ${result.placement} (${running} running)${result.errors.length ? `; skipped ${result.errors.join(" | ")}` : ""}`
      : `${sessionId}: could not open watcher: ${result.errors.join(" | ")}`,
  );
}

export async function runHookFromStdin(): Promise<void> {
  const log = (line: string) => {
    try {
      mkdirSync(STATE_DIR, { recursive: true });
      appendFileSync(join(STATE_DIR, "hook.log"), `${new Date().toISOString()} ${line}\n`);
    } catch {
      // logging must never fail the hook
    }
  };
  try {
    const input = JSON.parse(await readStdin()) as HookInput;
    await handleHook(input, {
      config: loadConfig(),
      env: process.env,
      platform: process.platform,
      stateDir: STATE_DIR,
      launch,
      log,
    });
  } catch (err) {
    log(`hook error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
