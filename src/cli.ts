#!/usr/bin/env node
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { findLatestTranscript, findTranscriptById, SessionWatcher } from "./session.js";

const USAGE = `claude-watch — live view of a Claude Code session and its subagents

Usage:
  claude-watch                     watch the most recently active session
  claude-watch <transcript.jsonl>  watch a session by its transcript path
  claude-watch <session-id>        watch a session by id
  claude-watch install-hook        add the auto-open hook to ~/.claude/settings.json
  claude-watch uninstall-hook      remove it again
  claude-watch hook                (used by the hook itself; reads stdin)

Options:
  --interval <ms>   how often to check for changes (default from config, 500)
  --settings <path> settings file for install-hook/uninstall-hook
  --dry-run         show what install-hook/uninstall-hook would change
  -h, --help        show this help`;

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "hook") {
    const { runHookFromStdin } = await import("./hook.js");
    await runHookFromStdin();
    return 0;
  }

  if (argv[0] === "install-hook" || argv[0] === "uninstall-hook") {
    const { install, uninstall } = await import("./install.js");
    const at = argv.indexOf("--settings");
    const opts = { settingsPath: at >= 0 ? argv[at + 1] : undefined, dryRun: argv.includes("--dry-run") };
    try {
      (argv[0] === "install-hook" ? install : uninstall)(opts);
      return 0;
    } catch (err) {
      console.error(`Could not update settings: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  let target: string | undefined;
  let intervalMs = loadConfig().intervalMs;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      return 0;
    }
    if (arg === "--interval") {
      intervalMs = Math.max(100, Number(argv[++i]) || 500);
    } else if (arg && !arg.startsWith("-")) {
      target = arg;
    } else {
      console.error(`Unknown option: ${arg}\n\n${USAGE}`);
      return 2;
    }
  }

  const transcript = await resolveTranscript(target);
  if (!transcript) {
    console.error(target ? `No session found for "${target}".` : "No Claude Code sessions found.");
    return 1;
  }

  // Loaded lazily so the hook path stays fast.
  const [{ render }, React, { App }] = await Promise.all([import("ink"), import("react"), import("./ui/App.js")]);
  const watcher = new SessionWatcher(transcript);
  const app = render(React.createElement(App, { watcher, intervalMs }));
  await app.waitUntilExit();
  return 0;
}

async function resolveTranscript(target: string | undefined): Promise<string | undefined> {
  if (!target) return findLatestTranscript();
  if (target.endsWith(".jsonl")) return existsSync(target) || target.includes("/") ? target : undefined;
  return findTranscriptById(target);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
