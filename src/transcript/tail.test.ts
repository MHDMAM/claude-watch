import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlTail } from "./tail.js";

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-watch-"));
  return join(dir, "t.jsonl");
}

describe("JsonlTail", () => {
  it("returns nothing for a missing file", async () => {
    const tail = new JsonlTail(join(tmpdir(), "does-not-exist.jsonl"));
    expect(await tail.readNew()).toEqual([]);
  });

  it("returns only lines appended since the last read", async () => {
    const path = await tempFile();
    await writeFile(path, '{"a":1}\n');
    const tail = new JsonlTail(path);
    expect(await tail.readNew()).toEqual([{ a: 1 }]);
    await appendFile(path, '{"b":2}\n{"c":3}\n');
    expect(await tail.readNew()).toEqual([{ b: 2 }, { c: 3 }]);
    expect(await tail.readNew()).toEqual([]);
  });

  it("holds back a partial line until it is completed", async () => {
    const path = await tempFile();
    await writeFile(path, '{"a":1}\n{"b":');
    const tail = new JsonlTail(path);
    expect(await tail.readNew()).toEqual([{ a: 1 }]);
    await appendFile(path, "2}\n");
    expect(await tail.readNew()).toEqual([{ b: 2 }]);
  });

  it("skips malformed lines", async () => {
    const path = await tempFile();
    await writeFile(path, 'not json\n{"ok":true}\n');
    expect(await new JsonlTail(path).readNew()).toEqual([{ ok: true }]);
  });

  it("starts over when the file shrinks", async () => {
    const path = await tempFile();
    await writeFile(path, '{"a":1}\n{"b":2}\n');
    const tail = new JsonlTail(path);
    await tail.readNew();
    await writeFile(path, '{"z":9}\n');
    expect(await tail.readNew()).toEqual([{ z: 9 }]);
  });
});
