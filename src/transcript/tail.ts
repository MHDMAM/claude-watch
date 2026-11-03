import { open, stat } from "node:fs/promises";

/**
 * Reads a growing JSONL file incrementally. Each call to `readNew()` returns
 * the complete lines appended since the previous call. A trailing partial
 * line (one Claude Code is still writing) is held back until it is finished.
 */
export class JsonlTail {
  private offset = 0;
  private carry = "";

  constructor(readonly path: string) {}

  async readNew(): Promise<unknown[]> {
    let size: number;
    try {
      size = (await stat(this.path)).size;
    } catch {
      return []; // file not created yet
    }
    if (size < this.offset) {
      // File was truncated or replaced: start over.
      this.offset = 0;
      this.carry = "";
    }
    if (size === this.offset) return [];

    const handle = await open(this.path, "r");
    try {
      const length = size - this.offset;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, this.offset);
      this.offset += bytesRead;
      const text = this.carry + buffer.subarray(0, bytesRead).toString("utf8");
      const lines = text.split("\n");
      this.carry = lines.pop() ?? "";
      return parseLines(lines);
    } finally {
      await handle.close();
    }
  }
}

function parseLines(lines: string[]): unknown[] {
  const out: unknown[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Skip a malformed line rather than stopping the whole stream.
    }
  }
  return out;
}
