import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./config.js";
import { asString, buildScript, shQuote } from "./launcher.js";

const iterm = { command: "exec watch", termProgram: "iTerm.app", itermSessionId: "w0t1p0:ABC-123" };

describe("buildScript", () => {
  it("splits the Claude session in iTerm2 and returns focus", () => {
    const s = buildScript("split", iterm, DEFAULT_CONFIG) as string;
    expect(s).toContain('if unique id of s is "ABC-123"');
    expect(s).toContain("split vertically with default profile");
    expect(s).toContain('write text "exec watch"');
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
    const s = buildScript("window", { command: "x", termProgram: "iTerm.app" }, DEFAULT_CONFIG) as string;
    expect(s).toContain("create window with default profile");
  });

  it("explains why a placement can't be used", () => {
    expect(buildScript("split", { command: "x", termProgram: "Apple_Terminal" }, DEFAULT_CONFIG)).toBeInstanceOf(Error);
    expect(buildScript("tab", { command: "x", termProgram: "iTerm.app" }, DEFAULT_CONFIG)).toBeInstanceOf(Error);
  });

  it("uses Terminal.app outside iTerm2", () => {
    const s = buildScript("window", { command: "x", termProgram: "Apple_Terminal" }, DEFAULT_CONFIG) as string;
    expect(s).toContain('tell application "Terminal"');
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
