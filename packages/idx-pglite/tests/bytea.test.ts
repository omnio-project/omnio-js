import { types } from "@electric-sql/pglite";
import { test, describe } from "vite-plus/test";

import { BYTEA_OID, parseBytea, serializeBytea } from "../src/bytea.js";

describe("parseBytea", () => {
  test("16 進数表記の bytea をバイト列に変換する", ({ expect }) => {
    // 実行：
    const actual = parseBytea("\\x000fff");

    // 検証：
    expect(actual).toStrictEqual(new Uint8Array([0, 15, 255]));
  });

  test("大文字の 16 進数表記も変換する", ({ expect }) => {
    // 実行：
    const actual = parseBytea("\\x00AFFf");

    // 検証：
    expect(actual).toStrictEqual(new Uint8Array([0, 175, 255]));
  });

  test("空の bytea を変換する", ({ expect }) => {
    // 実行：
    const actual = parseBytea("\\x");

    // 検証：
    expect(actual).toStrictEqual(new Uint8Array());
  });

  test("16 進数以外の表記は既定のパーサーに委譲する", ({ expect }) => {
    // 準備：
    const text = "a\\\\b";
    const parser = types.parsers[BYTEA_OID];

    // 実行：
    const actual = parseBytea(text);

    // 検証：
    expect(parser).toBeDefined();
    expect(actual).toStrictEqual(parser?.(text));
  });
});

describe("serializeBytea", () => {
  test("バイト列を 16 進数表記に変換する", ({ expect }) => {
    // 実行：
    const actual = serializeBytea(new Uint8Array([0, 15, 255]));

    // 検証：
    expect(actual).toBe("\\x000fff");
  });

  test("大きなバイト列を往復変換する", ({ expect }) => {
    // 準備：
    const bytes = new Uint8Array(768 * 4);

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index & 255;
    }

    // 実行：
    const actual = parseBytea(serializeBytea(bytes));

    // 検証：
    expect(actual).toStrictEqual(bytes);
  });
});
