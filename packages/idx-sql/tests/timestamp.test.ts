import { DbQueryError } from "@omniojs/core";
import { test, describe } from "vite-plus/test";

import { normalizeTimestamp } from "../src/timestamp.js";

describe("normalizeTimestamp", () => {
  test("ISO 8601 の日時をミリ秒付き UTC に変換する", ({ expect }) => {
    const cases = [
      ["2026-01-01T00:00:00Z", "2026-01-01T00:00:00.000Z"],
      ["2026-01-01T09:00:00+09:00", "2026-01-01T00:00:00.000Z"],
      ["2026-01-01T09:00:00+0900", "2026-01-01T00:00:00.000Z"],
      ["2026-01-01T09:00:00+09", "2026-01-01T00:00:00.000Z"],
      ["2026-01-01 09:00:00+0900", "2026-01-01T00:00:00.000Z"],
      ["2026-01-01T09:00:00-09", "2026-01-01T18:00:00.000Z"],
      ["2026-01-01T00:00:00.123456Z", "2026-01-01T00:00:00.123Z"],
    ] as const;

    for (const [input, expected] of cases) {
      // 実行と検証：
      expect(normalizeTimestamp(input, "test")).toBe(expected);
    }
  });

  test("Date をミリ秒付き UTC に変換する", ({ expect }) => {
    // 実行と検証：
    expect(normalizeTimestamp(new Date("2026-01-01T09:00:00+09:00"), "test")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  test("解釈できない日時は DbQueryError を投げる", ({ expect }) => {
    // 実行と検証：
    expect(() => normalizeTimestamp("not-a-date", "test")).toThrow(DbQueryError);
    expect(() => normalizeTimestamp(new Date("invalid"), "test")).toThrow(DbQueryError);
  });
});
