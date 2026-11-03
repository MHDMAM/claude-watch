import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { APP_DIR, configPath } from "./config.js";

/**
 * Adds or removes the claude-watch SubagentStart hook in a Claude Code
 * settings file, leaving every other setting and hook untouched.
 */

export const DEFAULT_SETTINGS = join(homedir(), ".claude", "settings.json");
const EVENT = "SubagentStart";

type Json = Record<string, unknown>;
interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
}
interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}

/**
 * Forward slashes work for Node on every OS and survive both Git Bash and
 * PowerShell quoting, unlike Windows backslashes.
 */
export function hookCommand(cliPath = join(APP_DIR, "dist", "cli.js")): string {
  return `node "${cliPath.replace(/\\/g, "/")}" hook`;
}

/** True for any hook entry that runs claude-watch's hook, wherever it's installed. */
export function isOurs(command: string): boolean {
  return /claude-watch/.test(command) && /\bhook\s*$/.test(command.trim());
}

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function groupsOf(settings: Json): HookGroup[] {
  const hooks = isObj(settings.hooks) ? settings.hooks : {};
  const list = hooks[EVENT];
  return Array.isArray(list) ? (list as HookGroup[]) : [];
}

export function hasHook(settings: Json): boolean {
  return groupsOf(settings).some((g) => g.hooks?.some((h) => isOurs(h.command ?? "")));
}

/** Returns new settings with our hook added (replacing any older copy of it). */
export function addHook(settings: Json, command: string): Json {
  const cleaned = removeHook(settings);
  const hooks = isObj(cleaned.hooks) ? { ...cleaned.hooks } : {};
  const groups = groupsOf(cleaned);
  hooks[EVENT] = [...groups, { hooks: [{ type: "command", command, timeout: 15 }] }];
  return { ...cleaned, hooks };
}

/** Returns new settings without our hook; empty groups and events are dropped. */
export function removeHook(settings: Json): Json {
  if (!isObj(settings.hooks)) return { ...settings };
  const groups = groupsOf(settings)
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h.command ?? "")) }))
    .filter((g) => g.hooks.length > 0);
  const hooks: Json = { ...settings.hooks };
  if (groups.length > 0) hooks[EVENT] = groups;
  else delete hooks[EVENT];
  const out: Json = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete out.hooks;
  return out;
}

function readSettings(path: string): Json {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8")); // throws on invalid JSON: we never overwrite it
  if (!isObj(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed;
}

function writeSettings(path: string, settings: Json): string | undefined {
  mkdirSync(dirname(path), { recursive: true });
  let backup: string | undefined;
  if (existsSync(path)) {
    backup = `${path}.claude-watch.bak`;
    copyFileSync(path, backup);
  }
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return backup;
}

export interface InstallOptions {
  settingsPath?: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export function install(opts: InstallOptions = {}): void {
  const path = opts.settingsPath ?? DEFAULT_SETTINGS;
  const log = opts.log ?? console.log;
  const command = hookCommand();
  const settings = readSettings(path);
  const existing = groupsOf(settings).flatMap((g) => g.hooks ?? []).find((h) => isOurs(h.command ?? ""));

  if (existing?.command === command) {
    log(`Already installed in ${path}`);
  } else if (opts.dryRun) {
    log(`Would ${existing ? "update" : "add"} the ${EVENT} hook in ${path}:\n  ${command}`);
  } else {
    const backup = writeSettings(path, addHook(settings, command));
    log(`${existing ? "Updated" : "Added"} the ${EVENT} hook in ${path}`);
    if (backup) log(`Backup of the previous file: ${backup}`);
  }

  const config = configPath();
  const example = join(APP_DIR, "config.example.json");
  if (!existsSync(config) && existsSync(example)) {
    if (opts.dryRun) log(`Would create ${config}`);
    else {
      copyFileSync(example, config);
      log(`Created ${config} (edit it to change where and when the watcher opens)`);
    }
  }
  if (!opts.dryRun) log("Restart any running Claude Code sessions to pick up the hook.");
}

export function uninstall(opts: InstallOptions = {}): void {
  const path = opts.settingsPath ?? DEFAULT_SETTINGS;
  const log = opts.log ?? console.log;
  const settings = readSettings(path);
  if (!hasHook(settings)) {
    log(`No claude-watch hook found in ${path}`);
    return;
  }
  if (opts.dryRun) {
    log(`Would remove the ${EVENT} hook from ${path}`);
    return;
  }
  const backup = writeSettings(path, removeHook(settings));
  log(`Removed the ${EVENT} hook from ${path}`);
  if (backup) log(`Backup of the previous file: ${backup}`);
}
