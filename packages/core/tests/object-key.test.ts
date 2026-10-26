import { test, describe } from "vite-plus/test";

import { InvalidOmnioKeyError } from "../src/errors/index.js";
import { OmnioKey } from "../src/object-key.js";

describe("parse", () => {
  test("パスを分解する", ({ expect }) => {
    // 実行：
    const actual = OmnioKey.parse("foo/bar/baz.txt");

    // 検証：
    expect(actual).toBeInstanceOf(OmnioKey);
    expect(actual.key).toBe("foo/bar/baz.txt");
    expect(actual.segments).toStrictEqual(["foo", "bar", "baz.txt"]);
    expect(actual.basename).toBe("baz.txt");
    expect(actual.filename).toBe("baz");
    expect(actual.extname).toBe(".txt");
    expect(actual.prefix).toBe("foo/bar/");
    expect(actual.toJSON()).toBe("foo/bar/baz.txt");
    expect(actual.toString()).toBe("foo/bar/baz.txt");
    expect(JSON.stringify(actual)).toBe('"foo/bar/baz.txt"');
  });

  test("単一セグメントの接頭辞は空文字である", ({ expect }) => {
    // 実行：
    const actual = OmnioKey.parse("root");

    // 検証：
    expect(actual.segments).toStrictEqual(["root"]);
    expect(actual.basename).toBe("root");
    expect(actual.prefix).toBe("");
  });

  test("複数拡張子と隠しファイルを分解する", ({ expect }) => {
    // 実行と検証：
    expect(OmnioKey.parse("archive.tar.gz").filename).toBe("archive.tar");
    expect(OmnioKey.parse("archive.tar.gz").extname).toBe(".gz");
    expect(OmnioKey.parse(".hidden").filename).toBe(".hidden");
    expect(OmnioKey.parse(".hidden").extname).toBe("");
    expect(OmnioKey.parse("Makefile").filename).toBe("Makefile");
    expect(OmnioKey.parse("Makefile").extname).toBe("");
  });

  test("マルチバイト文字を分解する", ({ expect }) => {
    // 実行：
    const actual = OmnioKey.parse("日本語/テスト.txt");

    // 検証：
    expect(actual.segments).toStrictEqual(["日本語", "テスト.txt"]);
    expect(actual.basename).toBe("テスト.txt");
    expect(actual.filename).toBe("テスト");
    expect(actual.extname).toBe(".txt");
    expect(actual.prefix).toBe("日本語/");
  });

  test("segments の返値はコピーである", ({ expect }) => {
    // 準備：
    const actual = OmnioKey.parse("a/b");

    // 実行：
    actual.segments.push("c");

    // 検証：
    expect(actual.segments).toStrictEqual(["a", "b"]);
  });
});

describe("check", () => {
  test.for([
    {
      input: "a",
      expected: true,
    },
    {
      input: "foo/bar",
      expected: true,
    },
    {
      input: "日本語",
      expected: true,
    },
    {
      input: "",
      expected: false,
    },
    {
      input: "a".repeat(1025),
      expected: false,
    },
    {
      input: "あ".repeat(342),
      expected: false,
    },
    {
      input: "\uD800",
      expected: false,
    },
  ])("check($input) -> $expected", ({ input, expected }, { expect }) => {
    // 実行：
    const actual = OmnioKey.check(input);

    // 検証：
    expect(actual).toBe(expected);
  });
});

describe("不正なキー", () => {
  test("空文字の parse は InvalidOmnioKeyError を投げる", ({ expect }) => {
    // 実行：
    let caught: unknown;

    try {
      OmnioKey.parse("");
    } catch (ex) {
      caught = ex;
    }

    // 検証：
    expect(caught).toBeInstanceOf(InvalidOmnioKeyError);

    const error = caught as InvalidOmnioKeyError;
    expect(error.name).toBe("OmnioInvalidKeyError");
    expect(error.meta).toStrictEqual({ input: "" });
    expect(error.message).toBe("Invalid object key");
  });

  test("1025 文字の parse は InvalidOmnioKeyError を投げる", ({ expect }) => {
    // 実行と検証：
    expect(() => OmnioKey.parse("a".repeat(1025))).toThrow(InvalidOmnioKeyError);
  });

  test("1024 文字は受け付ける", ({ expect }) => {
    // 実行と検証：
    expect(OmnioKey.parse("a".repeat(1024)).key).toBe("a".repeat(1024));
  });
});
