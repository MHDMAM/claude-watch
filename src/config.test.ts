import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig, mergeConfig } from "./config.js";

describe("config", () => {
  it("uses defaults when the file is missing", () => {
    expect(loadConfig(join(tmpdir(), "no-such-config.json"))).toEqual(DEFAULT_CONFIG);
  });

  it("reads overrides from a file", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "cw-")), "config.json");
    await writeFile(path, JSON.stringify({ placement: ["window"], minSubagents: 3 }));
    expect(loadConfig(path)).toMatchObject({ placement: ["window"], minSubagents: 3, keepFocus: true });
  });

  it("drops invalid values", () => {
    const c = mergeConfig({ placement: ["split", "bogus", "split"], minSubagents: 0, splitDirection: "diagonal" });
    expect(c.placement).toEqual(["split"]);
    expect(c.minSubagents).toBe(1);
    expect(c.splitDirection).toBe("vertical");
  });

  it("accepts a single placement string", () => {
    expect(mergeConfig({ placement: "tab" }).placement).toEqual(["tab"]);
  });

  it("falls back to the default order when nothing valid is given", () => {
    expect(mergeConfig({ placement: [] }).placement).toEqual(["split", "tab", "window"]);
  });
});
