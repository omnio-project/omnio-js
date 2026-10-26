import { safeParse } from "valibot";
import { test, describe } from "vite-plus/test";

import {
  MAX_TAGS,
  TagSchema,
  HashSchema,
  SizeSchema,
  TagsSchema,
  MAX_OBJECT_SIZE,
  ObjectKeySchema,
  TimestampSchema,
  ContentTypeSchema,
  DescriptionSchema,
  UserMetadataSchema,
  EmbeddingDimsSchema,
  EmbeddingModelSchema,
} from "../src/schemas.js";

describe("ObjectKeySchema", () => {
  test.for([
    {
      input: "a",
      success: true,
    },
    {
      input: "foo/bar/baz.txt",
      success: true,
    },
    {
      input: "日本語/キー",
      success: true,
    },
    {
      input: "a".repeat(1024),
      success: true,
    },
    {
      input: "",
      success: false,
    },
    {
      input: "a".repeat(1025),
      success: false,
    },
    {
      input: "あ".repeat(342),
      success: false,
    },
    {
      input: "\uD800",
      success: false,
    },
    {
      input: 123,
      success: false,
    },
    {
      input: null,
      success: false,
    },
  ])("parse($input) -> $success", ({ input, success }, { expect }) => {
    // 実行：
    const actual = safeParse(ObjectKeySchema, input).success;

    // 検証：
    expect(actual).toBe(success);
  });
});

describe("TagSchema", () => {
  test.for([
    {
      input: "red",
      success: true,
    },
    {
      input: "a".repeat(128),
      success: true,
    },
    {
      input: "",
      success: false,
    },
    {
      input: "a".repeat(129),
      success: false,
    },
    {
      input: "あ".repeat(43),
      success: false,
    },
    {
      input: 123,
      success: false,
    },
  ])("parse($input) -> $success", ({ input, success }, { expect }) => {
    // 実行：
    const actual = safeParse(TagSchema, input).success;

    // 検証：
    expect(actual).toBe(success);
  });
});

describe("TagsSchema", () => {
  test.for([
    {
      input: [],
      success: true,
    },
    {
      input: ["a", "b"],
      success: true,
    },
    {
      input: ["a"],
      success: true,
    },
    {
      input: "a",
      success: false,
    },
    {
      input: [""],
      success: false,
    },
    {
      input: [123],
      success: false,
    },
  ])("parse($input) -> $success", ({ input, success }, { expect }) => {
    // 実行：
    const actual = safeParse(TagsSchema, input).success;

    // 検証：
    expect(actual).toBe(success);
  });

  test("上限を超える件数は失敗する", ({ expect }) => {
    // 準備：
    const input = Array.from({ length: MAX_TAGS + 1 }, (_, index) => `tag${index}`);

    // 実行と検証：
    expect(safeParse(TagsSchema, input).success).toBe(false);
    expect(safeParse(TagsSchema, input.slice(0, MAX_TAGS)).success).toBe(true);
  });
});

describe("DescriptionSchema", () => {
  test.for([
    {
      input: "",
      success: true,
    },
    {
      input: "夕日の海辺",
      success: true,
    },
    {
      input: 123,
      success: false,
    },
  ])("parse($input) -> $success", ({ input, success }, { expect }) => {
    // 実行：
    const actual = safeParse(DescriptionSchema, input).success;

    // 検証：
    expect(actual).toBe(success);
  });
});

describe("ContentTypeSchema", () => {
  test("小文字に正規化する", ({ expect }) => {
    // 実行：
    const actual = safeParse(ContentTypeSchema, "Text/Plain");

    // 検証：
    expect(actual.success).toBe(true);
    expect(actual.output).toBe("text/plain");
  });

  test("文字列以外は失敗する", ({ expect }) => {
    // 実行と検証：
    expect(safeParse(ContentTypeSchema, 123).success).toBe(false);
  });
});

describe("HashSchema", () => {
  test.for([
    {
      input: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      success: true,
    },
    {
      input: "",
      success: false,
    },
    {
      input: "xyz",
      success: false,
    },
    {
      input: "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
      success: false,
    },
  ])("parse($input) -> $success", ({ input, success }, { expect }) => {
    // 実行：
    const actual = safeParse(HashSchema, input).success;

    // 検証：
    expect(actual).toBe(success);
  });
});

describe("SizeSchema", () => {
  test.for([
    {
      input: 0,
      success: true,
    },
    {
      input: 1024,
      success: true,
    },
    {
      input: MAX_OBJECT_SIZE,
      success: true,
    },
    {
      input: -1,
      success: false,
    },
    {
      input: 1.5,
      success: false,
    },
    {
      input: MAX_OBJECT_SIZE + 1,
      success: false,
    },
  ])("parse($input) -> $success", ({ input, success }, { expect }) => {
    // 実行：
    const actual = safeParse(SizeSchema, input).success;

    // 検証：
    expect(actual).toBe(success);
  });
});

describe("TimestampSchema", () => {
  test.for([
    {
      input: "2026-01-01T00:00:00Z",
      success: true,
    },
    {
      input: "2026-01-01T09:00:00+09:00",
      success: true,
    },
    {
      input: "2026-01-01",
      success: false,
    },
    {
      input: "not-a-date",
      success: false,
    },
  ])("parse($input) -> $success", ({ input, success }, { expect }) => {
    // 実行：
    const actual = safeParse(TimestampSchema, input).success;

    // 検証：
    expect(actual).toBe(success);
  });
});

describe("EmbeddingDimsSchema", () => {
  test.for([
    {
      input: 1,
      success: true,
    },
    {
      input: 768,
      success: true,
    },
    {
      input: 0,
      success: false,
    },
    {
      input: 1.5,
      success: false,
    },
  ])("parse($input) -> $success", ({ input, success }, { expect }) => {
    // 実行：
    const actual = safeParse(EmbeddingDimsSchema, input).success;

    // 検証：
    expect(actual).toBe(success);
  });
});

describe("EmbeddingModelSchema", () => {
  test.for([
    {
      input: "embeddinggemma-2",
      success: true,
    },
    {
      input: "",
      success: false,
    },
    {
      input: 123,
      success: false,
    },
  ])("parse($input) -> $success", ({ input, success }, { expect }) => {
    // 実行：
    const actual = safeParse(EmbeddingModelSchema, input).success;

    // 検証：
    expect(actual).toBe(success);
  });
});

describe("UserMetadataSchema", () => {
  test.for([
    {
      input: {},
      success: true,
    },
    {
      input: { genre: "test" },
      success: true,
    },
    {
      input: null,
      success: true,
    },
    {
      input: 123,
      success: true,
    },
  ])("parse($input) -> $success", ({ input, success }, { expect }) => {
    // 実行：
    const actual = safeParse(UserMetadataSchema, input).success;

    // 検証：
    expect(actual).toBe(success);
  });
});
