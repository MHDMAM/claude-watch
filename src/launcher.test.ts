import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./config.js";
import { asString, buildPlan, buildScript, buildWindowsPlan, type LaunchContext, type LaunchPlan, shQuote } from "./launcher.js";

const argv = ["/usr/bin/node", "/a b/cli.js", "/p/s1.jsonl"];
const iterm: LaunchContext = { argv, platform: "darwin", termProgram: "iTerm.app", itermSessionId: "w0t1p0:ABC-123" };

describe("buildScript (macOS)", () => {
  it("splits the Claude session in iTerm2 and returns focus", () => {
    const s = buildScript("split", iterm, DEFAULT_CONFIG) as string;
    expect(s).toContain('if unique id of s is "ABC-123"');
    expect(s).toContain("split vertically with default profile");
    expect(s).toContain(`write text " exec '/usr/bin/node' '/a b/cli.js' '/p/s1.jsonl'"`);
    expect(s).toContain("tell s to select");
  });

  it("honours split direction and keepFocus", () => {
    const s = buildScript("split", iterm, { ...DEFAULT_CONFIG, splitDirection: "horizontal", keepFocus: false });
    expect(s).toContain("split horizontally");
    expect(s).not.toContain("tell s to select");
  });

  it("opens a tab in Claude's window", () => {
    const s = buildScript("tab", iterm, DEFAULT_CONFIG) as string;
    expect(s).toContain("tell w to set newTab to (create tab with default profile)");
  });

  it("opens a window without needing the session id", () => {
    const s = buildScript("window", { ...iterm, itermSessionId: undefined }, DEFAULT_CONFIG) as string;
    expect(s).toContain("create window with default profile");
  });

  it("explains why a placement can't be used", () => {
    expect(buildScript("split", { ...iterm, termProgram: "Apple_Terminal" }, DEFAULT_CONFIG)).toBeInstanceOf(Error);
    expect(buildScript("tab", { ...iterm, itermSessionId: undefined }, DEFAULT_CONFIG)).toBeInstanceOf(Error);
  });

  it("uses Terminal.app outside iTerm2", () => {
    const s = buildScript("window", { ...iterm, termProgram: "Apple_Terminal" }, DEFAULT_CONFIG) as string;
    expect(s).toContain('tell application "Terminal"');
  });

  it("runs the script through osascript", () => {
    expect((buildPlan("split", iterm, DEFAULT_CONFIG) as LaunchPlan).file).toBe("osascript");
  });
});

describe("buildWindowsPlan", () => {
  const winArgv = ["C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\me\\.claude\\claude-watch\\dist\\cli.js", "C:\\x\\s1.jsonl"];
  const wt: LaunchContext = { argv: winArgv, platform: "win32", wtSession: "0f1e-guid" };

  it("splits the current Windows Terminal window and moves focus back", () => {
    const p = buildWindowsPlan("split", wt, DEFAULT_CONFIG) as LaunchPlan;
    expect(p.file).toBe("wt.exe");
    expect(p.args).toEqual(["-w", "0", "split-pane", "-V", "--title", "claude-watch", ...winArgv, ";", "move-focus", "left"]);
  });

  it("splits below and keeps focus when configured", () => {
    const p = buildWindowsPlan("split", wt, { ...DEFAULT_CONFIG, splitDirection: "horizontal", keepFocus: false }) as LaunchPlan;
    expect(p.args.slice(0, 4)).toEqual(["-w", "0", "split-pane", "-H"]);
    expect(p.args).not.toContain(";");
  });

  it("opens a tab and returns to the previous one", () => {
    const p = buildWindowsPlan("tab", wt, DEFAULT_CONFIG) as LaunchPlan;
    expect(p.args).toEqual(["-w", "0", "new-tab", "--title", "claude-watch", ...winArgv, ";", "focus-tab", "--previous"]);
  });

  it("needs Windows Terminal for split and tab", () => {
    const plain = { ...wt, wtSession: undefined };
    expect(buildWindowsPlan("split", plain, DEFAULT_CONFIG)).toBeInstanceOf(Error);
    expect(buildWindowsPlan("tab", plain, DEFAULT_CONFIG)).toBeInstanceOf(Error);
  });

  it("opens a new console window with cmd start anywhere", () => {
    const p = buildWindowsPlan("window", { ...wt, wtSession: undefined }, DEFAULT_CONFIG) as LaunchPlan;
    expect(p).toEqual({
      file: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        `"start "claude-watch" "C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\.claude\\claude-watch\\dist\\cli.js" "C:\\x\\s1.jsonl""`,
      ],
      verbatim: true,
    });
  });
});

describe("other platforms", () => {
  it("explains that auto-open isn't supported", () => {
    expect(buildPlan("window", { argv, platform: "linux" }, DEFAULT_CONFIG)).toBeInstanceOf(Error);
  });
});

describe("quoting", () => {
  it("escapes AppleScript strings", () => {
    expect(asString('a "b" \\c')).toBe('"a \\"b\\" \\\\c"');
  });

  it("quotes shell arguments", () => {
    expect(shQuote("it's here")).toBe(`'it'\\''s here'`);
  });
});
