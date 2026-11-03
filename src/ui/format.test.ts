import { describe, expect, it } from "vitest";
import { formatDuration, formatTokens, modelFamily, shortModel, truncate } from "./format.js";

describe("format helpers", () => {
  it("shortens model ids", () => {
    expect(shortModel("claude-haiku-5-5")).toBe("haiku 5.5");
    expect(shortModel("claude-opus-5-5[1m]")).toBe("opus 5.5");
    expect(shortModel("claude-sonnet-4-20250514")).toBe("sonnet 4");
    expect(shortModel(undefined)).toBe("…");
    expect(modelFamily("claude-sonnet-5-5")).toBe("sonnet");
  });

  it("formats tokens", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(12_000)).toBe("12k");
    expect(formatTokens(668_400)).toBe("668k");
    expect(formatTokens(1_250_000)).toBe("1.25M");
    expect(formatTokens(2_000_000)).toBe("2M");
  });

  it("formats durations", () => {
    expect(formatDuration(4_000)).toBe("4s");
    expect(formatDuration(95_000)).toBe("1m35s");
    expect(formatDuration(3_960_000)).toBe("1h06m");
  });

  it("truncates", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });
});
