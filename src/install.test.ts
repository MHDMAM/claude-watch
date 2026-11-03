import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addHook, hasHook, install, isOurs, removeHook, uninstall } from "./install.js";

const CMD = 'node "/x/claude-watch/dist/cli.js" hook';
const other = { type: "command", command: "/usr/local/bin/cc-status" };

describe("isOurs", () => {
  it("matches claude-watch hook commands only", () => {
    expect(isOurs(CMD)).toBe(true);
    expect(isOurs("node /Users/me/.claude/claude-watch/dist/cli.js hook")).toBe(true);
    expect(isOurs("/usr/local/bin/cc-status")).toBe(false);
    expect(isOurs('node "/x/claude-watch/dist/cli.js"')).toBe(false);
  });
});

describe("addHook / removeHook", () => {
  it("adds the hook and keeps other settings and hooks", () => {
    const before = { model: "opus", hooks: { SubagentStop: [{ hooks: [other] }], SubagentStart: [{ hooks: [other] }] } };
    const after = addHook(before, CMD);
    expect(after.model).toBe("opus");
    expect(hasHook(after)).toBe(true);
    expect((after.hooks as any).SubagentStop).toEqual([{ hooks: [other] }]);
    expect((after.hooks as any).SubagentStart).toHaveLength(2);
  });

  it("replaces an older copy instead of adding a duplicate", () => {
    const once = addHook({}, 'node "/old/claude-watch/dist/cli.js" hook');
    const twice = addHook(once, CMD);
    const commands = (twice.hooks as any).SubagentStart.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(commands).toEqual([CMD]);
  });

  it("removes only our hook and tidies empty sections", () => {
    expect(removeHook(addHook({}, CMD))).toEqual({});
    const mixed = addHook({ hooks: { SubagentStart: [{ hooks: [other] }] } }, CMD);
    expect(removeHook(mixed)).toEqual({ hooks: { SubagentStart: [{ hooks: [other] }] } });
  });
});

describe("install / uninstall", () => {
  it("round-trips a settings file and backs it up", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-install-"));
    const path = join(dir, "settings.json");
    await writeFile(path, JSON.stringify({ theme: "dark" }));
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);

    install({ settingsPath: path, log });
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(installed.theme).toBe("dark");
    expect(hasHook(installed)).toBe(true);
    expect(JSON.parse(await readFile(`${path}.claude-watch.bak`, "utf8"))).toEqual({ theme: "dark" });

    install({ settingsPath: path, log });
    expect(lines.some((l) => l.startsWith("Already installed"))).toBe(true);

    uninstall({ settingsPath: path, log });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ theme: "dark" });
  });

  it("creates the settings file when missing and never writes on dry run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-install-"));
    const path = join(dir, "nested", "settings.json");
    install({ settingsPath: path, dryRun: true, log: () => {} });
    await expect(readFile(path, "utf8")).rejects.toThrow();
    install({ settingsPath: path, log: () => {} });
    expect(hasHook(JSON.parse(await readFile(path, "utf8")))).toBe(true);
  });

  it("refuses to touch a settings file that isn't valid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-install-"));
    const path = join(dir, "settings.json");
    await writeFile(path, "{ not json");
    expect(() => install({ settingsPath: path, log: () => {} })).toThrow();
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });
});
