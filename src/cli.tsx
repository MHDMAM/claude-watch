#!/usr/bin/env node
import { render } from "ink";
import { existsSync } from "node:fs";
import { findLatestTranscript, findTranscriptById, SessionWatcher } from "./session.js";
import { App } from "./ui/App.js";

const USAGE = `claude-watch — live view of a Claude Code session and its subagents

Usage:
  claude-watch                     watch the most recently active session
  claude-watch <transcript.jsonl>  watch a session by its transcript path
  claude-watch <session-id>        watch a session by id

Options:
  --interval <ms>   how often to check for changes (default 500)
  -h, --help        show this help`;

async function main(argv: string[]): Promise<number> {
  let target: string | undefined;
  let intervalMs = 500;

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

  const watcher = new SessionWatcher(transcript);
  const app = render(<App watcher={watcher} intervalMs={intervalMs} />);
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
