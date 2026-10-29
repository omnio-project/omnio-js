import { setGlobalConfig, deleteGlobalConfig } from "valibot";
import { test as vitest, describe } from "vite-plus/test";

import {
  ErrorBase,
  DbErrorBase,
  DbQueryError,
  EmbErrorBase,
  DbNotOpenError,
  ModelLoadError,
  EmbedFailedError,
  EntityMissingError,
  InvalidOmnioKeyError,
  OperationAbortedError,
  UnsupportedModalityError,
  EmbeddingModelMismatchError,
  VectorDimensionMismatchError,
} from "../src/index.js";

/**
 * 言語設定をテスト内でのみ変更するためのフィクスチャーです。
 *
 * 設定した言語はテスト終了後に削除され、ほかのテストに影響しません。
 */
const test = vitest.extend<{
  setLang: (lang: string) => void;
}>({
  async setLang({}, use) {
    await use((lang) => {
      setGlobalConfig({ lang });
    });
    deleteGlobalConfig();
  },
});
describe("DbNotOpenError", () => {
  test("DbErrorBase を継承し name は OmnioDbNotOpenError である", ({ expect }) => {
    // 実行：
    const error = new DbNotOpenError({ operation: "upsert" });

    // 検証：
    expect(error).toBeInstanceOf(DbErrorBase);
    expect(error).toBeInstanceOf(ErrorBase);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("OmnioDbNotOpenError");
  });

  test("meta に操作名を保持する", ({ expect }) => {
    // 実行：
    const error = new DbNotOpenError({ operation: "upsert" });

    // 検証：
    expect(error.meta).toStrictEqual({ operation: "upsert" });
  });

  test("既定のメッセージは英語である", ({ expect }) => {
    // 実行：
    const error = new DbNotOpenError({ operation: "upsert" });

    // 検証：
    expect(error.message).toBe("Database is not open: upsert requires an open connection");
  });

  test("ja では日本語のメッセージを返す", ({ expect, setLang }) => {
    // 準備：
    setLang("ja");

    // 実行：
    const error = new DbNotOpenError({ operation: "upsert" });

    // 検証：
    expect(error.message).toBe("データベースが開いていません: upsert には開いた接続が必要です");
  });

  test("未登録の言語では既定のメッセージにフォールバックする", ({ expect, setLang }) => {
    // 準備：
    setLang("xx");

    // 実行：
    const error = new DbNotOpenError({ operation: "upsert" });

    // 検証：
    expect(error.message).toBe("Database is not open: upsert requires an open connection");
  });
});
describe("DbQueryError", () => {
  test("DbErrorBase を継承し name は OmnioDbQueryError である", ({ expect }) => {
    // 実行：
    const error = new DbQueryError({ operation: "search" });

    // 検証：
    expect(error).toBeInstanceOf(DbErrorBase);
    expect(error.name).toBe("OmnioDbQueryError");
  });

  test("クエリーなしでは操作名のみのメッセージを返す", ({ expect }) => {
    // 実行：
    const error = new DbQueryError({ operation: "search" });

    // 検証：
    expect(error.meta).toStrictEqual({ operation: "search" });
    expect(error.message).toBe("Failed to execute database operation: search");
  });

  test("クエリーありではクエリーを含むメッセージを返す", ({ expect }) => {
    // 実行：
    const error = new DbQueryError({
      operation: "search",
      queryText: "SELECT 1",
    });

    // 検証：
    expect(error.meta).toStrictEqual({
      operation: "search",
      queryText: "SELECT 1",
    });
    expect(error.message).toBe("Failed to execute database operation: search (SELECT 1)");
  });

  test("ja では日本語のメッセージを返す", ({ expect, setLang }) => {
    // 準備：
    setLang("ja");

    // 実行と検証：
    expect(new DbQueryError({ operation: "search" }).message).toBe(
      "データベース操作に失敗しました: search",
    );
    expect(
      new DbQueryError({
        operation: "search",
        queryText: "SELECT 1",
      }).message,
    ).toBe("データベース操作に失敗しました: search (SELECT 1)");
  });

  test("cause を保持する", ({ expect }) => {
    // 準備：
    const cause = new Error("connection refused");

    // 実行：
    const error = new DbQueryError({
      cause,
      operation: "search",
    });

    // 検証：
    expect(error.cause).toBe(cause);
  });
});
describe("VectorDimensionMismatchError", () => {
  test("DbErrorBase を継承し name は OmnioVectorDimensionMismatchError である", ({ expect }) => {
    // 実行：
    const error = new VectorDimensionMismatchError({
      actual: 384,
      expected: 768,
    });

    // 検証：
    expect(error).toBeInstanceOf(DbErrorBase);
    expect(error.name).toBe("OmnioVectorDimensionMismatchError");
  });

  test("meta に次元数を保持し英語のメッセージを返す", ({ expect }) => {
    // 実行：
    const error = new VectorDimensionMismatchError({
      actual: 384,
      expected: 768,
    });

    // 検証：
    expect(error.meta).toStrictEqual({
      actual: 384,
      expected: 768,
    });
    expect(error.message).toBe("Vector dimension mismatch: expected 768, but got 384");
  });

  test("ja では日本語のメッセージを返す", ({ expect, setLang }) => {
    // 準備：
    setLang("ja");

    // 実行：
    const error = new VectorDimensionMismatchError({
      actual: 384,
      expected: 768,
    });

    // 検証：
    expect(error.message).toBe(
      "ベクトルの次元数が一致しません: 768 を期待しましたが、384 を受け取りました",
    );
  });
});
describe("EmbeddingModelMismatchError", () => {
  test("DbErrorBase を継承し name は OmnioEmbeddingModelMismatchError である", ({ expect }) => {
    // 実行：
    const error = new EmbeddingModelMismatchError({
      actual: "model-a",
      expected: "model-b",
    });

    // 検証：
    expect(error).toBeInstanceOf(DbErrorBase);
    expect(error.name).toBe("OmnioEmbeddingModelMismatchError");
  });

  test("モデル名ありでは両方のモデル名を含むメッセージを返す", ({ expect }) => {
    // 実行：
    const error = new EmbeddingModelMismatchError({
      actual: "model-a",
      expected: "model-b",
    });

    // 検証：
    expect(error.meta).toStrictEqual({
      actual: "model-a",
      expected: "model-b",
    });
    expect(error.message).toBe("Embedding model mismatch: expected model-b, but got model-a");
  });

  test("モデル名なしでは記録なしを示すメッセージを返す", ({ expect }) => {
    // 実行：
    const error = new EmbeddingModelMismatchError({ expected: "model-b" });

    // 検証：
    expect(error.meta).toStrictEqual({ expected: "model-b" });
    expect(error.message).toBe(
      "Embedding model mismatch: expected model-b, but the record has no model",
    );
  });

  test("ja では日本語のメッセージを返す", ({ expect, setLang }) => {
    // 準備：
    setLang("ja");

    // 実行と検証：
    expect(
      new EmbeddingModelMismatchError({
        actual: "model-a",
        expected: "model-b",
      }).message,
    ).toBe("埋め込みモデルが一致しません: model-b を期待しましたが、model-a を受け取りました");
    expect(new EmbeddingModelMismatchError({ expected: "model-b" }).message).toBe(
      "埋め込みモデルが一致しません: model-b を期待しましたが、レコードにモデル名がありません",
    );
  });
});
describe("UnsupportedModalityError", () => {
  test("EmbErrorBase を継承し name は OmnioUnsupportedModalityError である", ({ expect }) => {
    // 実行：
    const error = new UnsupportedModalityError({
      actual: "image",
      supported: ["text"],
    });

    // 検証：
    expect(error).toBeInstanceOf(EmbErrorBase);
    expect(error).toBeInstanceOf(ErrorBase);
    expect(error.name).toBe("OmnioUnsupportedModalityError");
  });

  test("meta に対応一覧を凍結して保持する", ({ expect }) => {
    // 準備：
    const supported = ["text"];

    // 実行：
    const error = new UnsupportedModalityError({
      actual: "image",
      supported,
    });

    // 検証：
    expect(error.meta).toStrictEqual({
      actual: "image",
      supported: ["text"],
    });
    expect(Object.isFrozen(error.meta.supported)).toBe(true);
  });

  test("既定のメッセージは英語である", ({ expect }) => {
    // 実行：
    const error = new UnsupportedModalityError({
      actual: "image",
      supported: ["text"],
    });

    // 検証：
    expect(error.message).toBe("Unsupported modality: image (supported: text)");
  });

  test("ja では日本語のメッセージを返す", ({ expect, setLang }) => {
    // 準備：
    setLang("ja");

    // 実行：
    const error = new UnsupportedModalityError({
      actual: "image",
      supported: ["text", "audio"],
    });

    // 検証：
    expect(error.message).toBe("対応していないモダリティーです: image (対応: text、audio)");
  });
});
describe("EmbedFailedError", () => {
  test("EmbErrorBase を継承し name は OmnioEmbedFailedError である", ({ expect }) => {
    // 実行：
    const error = new EmbedFailedError({ kind: "text" });

    // 検証：
    expect(error).toBeInstanceOf(EmbErrorBase);
    expect(error.name).toBe("OmnioEmbedFailedError");
  });

  test("meta に入力の種類を保持し cause を保持する", ({ expect }) => {
    // 準備：
    const cause = new Error("model crashed");

    // 実行：
    const error = new EmbedFailedError({
      kind: "text",
      cause,
    });

    // 検証：
    expect(error.meta).toStrictEqual({ kind: "text" });
    expect(error.cause).toBe(cause);
  });

  test("既定のメッセージは英語である", ({ expect }) => {
    // 実行：
    const error = new EmbedFailedError({ kind: "text" });

    // 検証：
    expect(error.message).toBe("Failed to embed input of kind: text");
  });

  test("ja では日本語のメッセージを返す", ({ expect, setLang }) => {
    // 準備：
    setLang("ja");

    // 実行：
    const error = new EmbedFailedError({ kind: "text" });

    // 検証：
    expect(error.message).toBe("種類 text の入力の埋め込みに失敗しました");
  });
});
describe("ModelLoadError", () => {
  test("EmbErrorBase を継承し name は OmnioModelLoadError である", ({ expect }) => {
    // 実行：
    const error = new ModelLoadError({ model: "embeddinggemma-2" });

    // 検証：
    expect(error).toBeInstanceOf(EmbErrorBase);
    expect(error.name).toBe("OmnioModelLoadError");
  });

  test("meta にモデル名を保持し cause を保持する", ({ expect }) => {
    // 準備：
    const cause = new Error("fetch failed");

    // 実行：
    const error = new ModelLoadError({
      cause,
      model: "embeddinggemma-2",
    });

    // 検証：
    expect(error.meta).toStrictEqual({ model: "embeddinggemma-2" });
    expect(error.cause).toBe(cause);
  });

  test("既定のメッセージは英語である", ({ expect }) => {
    // 実行：
    const error = new ModelLoadError({ model: "embeddinggemma-2" });

    // 検証：
    expect(error.message).toBe("Failed to load embedding model: embeddinggemma-2");
  });

  test("ja では日本語のメッセージを返す", ({ expect, setLang }) => {
    // 準備：
    setLang("ja");

    // 実行：
    const error = new ModelLoadError({ model: "embeddinggemma-2" });

    // 検証：
    expect(error.message).toBe("埋め込みモデルの読み込みに失敗しました: embeddinggemma-2");
  });
});
describe("InvalidOmnioKeyError", () => {
  test("InvalidUsageErrorBase を継承し name は OmnioInvalidKeyError である", ({ expect }) => {
    // 実行：
    const error = new InvalidOmnioKeyError({ input: "" });

    // 検証：
    expect(error).toBeInstanceOf(ErrorBase);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("OmnioInvalidKeyError");
  });

  test("meta に入力値を保持する", ({ expect }) => {
    // 実行：
    const error = new InvalidOmnioKeyError({ input: "" });

    // 検証：
    expect(error.meta).toStrictEqual({ input: "" });
  });

  test("既定のメッセージは英語である", ({ expect }) => {
    // 実行：
    const error = new InvalidOmnioKeyError({ input: "" });

    // 検証：
    expect(error.message).toBe("Invalid object key");
  });

  test("ja では日本語のメッセージを返す", ({ expect, setLang }) => {
    // 準備：
    setLang("ja");

    // 実行：
    const error = new InvalidOmnioKeyError({ input: "" });

    // 検証：
    expect(error.message).toBe("無効なオブジェクトキーです");
  });
});
describe("EntityMissingError", () => {
  test("UnexpectedErrorBase を継承し name は OmnioEntityMissingError である", ({ expect }) => {
    // 実行：
    const error = new EntityMissingError({
      key: "foo/bar",
      entityId: "entity",
    });

    // 検証：
    expect(error).toBeInstanceOf(ErrorBase);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("OmnioEntityMissingError");
    expect(error.meta).toStrictEqual({
      key: "foo/bar",
      entityId: "entity",
    });
  });

  test("既定のメッセージは英語である", ({ expect }) => {
    // 実行：
    const error = new EntityMissingError({
      key: "foo/bar",
      entityId: "entity",
    });

    // 検証：
    expect(error.message).toBe("Entity data is missing: foo/bar (entity)");
  });

  test("ja では日本語のメッセージを返す", ({ expect, setLang }) => {
    // 準備：
    setLang("ja");

    // 実行：
    const error = new EntityMissingError({
      key: "foo/bar",
      entityId: "entity",
    });

    // 検証：
    expect(error.message).toBe("実体データが見つかりません: foo/bar (entity)");
  });
});
describe("OperationAbortedError", () => {
  test("ErrorBase を継承し name は OmnioOperationAbortedError である", ({ expect }) => {
    // 実行：
    const error = new OperationAbortedError();

    // 検証：
    expect(error).toBeInstanceOf(ErrorBase);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("OmnioOperationAbortedError");
  });

  test("既定のメッセージは英語である", ({ expect }) => {
    // 実行：
    const error = new OperationAbortedError();

    // 検証：
    expect(error.message).toBe("Operation aborted");
  });

  test("ja では日本語のメッセージを返す", ({ expect, setLang }) => {
    // 準備：
    setLang("ja");

    // 実行：
    const error = new OperationAbortedError();

    // 検証：
    expect(error.message).toBe("操作が中断されました");
  });
});
